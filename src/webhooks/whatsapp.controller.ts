import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MetaWhatsappService } from '../integrations/meta/meta-whatsapp.service';
import { AgentService } from '../agent/agent.service';
import type { MetaWebhookPayload } from '../integrations/meta/dto/meta-message.dto';

@Controller('webhooks/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly metaService: MetaWhatsappService,
    private readonly agentService: AgentService,
  ) {}

  /**
   * GET /webhooks/whatsapp
   * Handshake de verificación requerido por Meta al configurar el webhook.
   * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
   */
  @Get()
  handleVerification(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === this.metaService.getVerifyToken()) {
      this.logger.log('Webhook de Meta verificado correctamente.');
      return challenge;
    }
    this.logger.warn('Intento de verificación fallido: token incorrecto.');
    throw new ForbiddenException('Token de verificación inválido');
  }

  /**
   * POST /webhooks/whatsapp
   * Receptor de mensajes y eventos entrantes desde la API Cloud de Meta.
   * Responde 200 de inmediato y procesa en background.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  handleIncoming(
    @Body() body: MetaWebhookPayload,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: Request,
  ): { status: string } {
    // Verificar firma HMAC-SHA256
    const rawBody: Buffer = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(body));

    if (!this.metaService.verifySignature(rawBody, signature)) {
      this.logger.warn('Firma del webhook inválida. Solicitud rechazada.');
      throw new ForbiddenException('Firma inválida');
    }

    // Ignorar eventos que no sean del objeto esperado
    if (body?.object !== 'whatsapp_business_account') {
      this.logger.debug(`Evento ignorado (object: ${body?.object})`);
      return { status: 'ignored' };
    }

    // Procesar en background sin bloquear la respuesta HTTP
    void this.processAsync(body);
    return { status: 'received' };
  }

  private async processAsync(payload: MetaWebhookPayload): Promise<void> {
    try {
      const result = this.metaService.extractFirstTextMessage(payload);

      if (!result) {
        this.logger.debug('Webhook sin mensaje de texto procesable. Ignorado.');
        return;
      }

      const { from, text } = result;
      this.logger.log(`Mensaje entrante de +${from}: "${text.substring(0, 50)}"`);

      // Procesamos con el agente (mantiene historial por número)
      const reply = await this.agentService.processMessage(
        from,
        'WHATSAPP',
        text,
      );

      // Respondemos al cliente vía Meta Cloud API
      await this.metaService.sendTextMessage(from, reply);
    } catch (error: unknown) {
      this.logger.error(
        `Error al procesar webhook de WhatsApp (Meta): ${(error as Error).message}`,
      );
    }
  }
}
