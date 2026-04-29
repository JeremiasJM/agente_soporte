import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { MetaWhatsappService } from '../integrations/meta/meta-whatsapp.service';
import { CustomersService } from '../customers/customers.service';
import { PlaneService } from '../integrations/plane/plane.service';

interface PlaneWebhookPayload {
  action?: string;
  event?: string;
  data?: {
    id?: string;
    custom_id?: string;       // ID del customer en Plane (si lo incluye el webhook)
    state_detail?: {
      group?: string;
      name?: string;
    };
    description_stripped?: string;
  };
}

@Controller('webhooks/plane')
export class PlaneWebhookController {
  private readonly logger = new Logger(PlaneWebhookController.name);

  constructor(
    private readonly planeService: PlaneService,
    private readonly metaService: MetaWhatsappService,
    private readonly customersService: CustomersService,
  ) {}

  /**
   * Webhook de Plane: recibe eventos de actualización de tickets.
   * Cuando un ticket es marcado como resuelto, notifica al cliente por WhatsApp.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handlePlaneEvent(
    @Body() body: PlaneWebhookPayload,
  ): Promise<{ status: string }> {
    const planeTicketId = body?.data?.id;
    const stateGroup = body?.data?.state_detail?.group;
    const stateName = body?.data?.state_detail?.name;

    // Solo procesar eventos de resolución
    if (!planeTicketId || stateGroup !== 'done') {
      return { status: 'ignored' };
    }

    this.logger.log(`Ticket resuelto en Plane: ${planeTicketId} (${stateName})`);

    void this.notifyResolutionAsync(planeTicketId, stateName ?? 'Resuelto', body.data?.custom_id);
    return { status: 'processing' };
  }

  private async notifyResolutionAsync(
    planeTicketId: string,
    stateName: string,
    customerId?: string,
  ): Promise<void> {
    try {
      // Si el webhook incluye el customer ID, lo usamos directamente
      if (!customerId) {
        this.logger.log(`Ticket ${planeTicketId} resuelto pero sin customer_id en el payload — sin notificación automática.`);
        return;
      }

      const customer = await this.customersService.validateCustomer(customerId);
      if (!customer) {
        this.logger.warn(`Cliente no encontrado para ticket: ${planeTicketId}`);
        return;
      }

      const phone = customer.website_url;
      if (!phone) {
        this.logger.warn(`Cliente ${customerId} sin número WhatsApp (website_url vacío)`);
        return;
      }

      const message =
        `✅ *Ticket resuelto*\n\n` +
        `Tu ticket #${planeTicketId} ha sido marcado como *${stateName}*.\n\n` +
        `Si el problema persiste o tenés alguna consulta adicional, no dudes en escribirnos.\n\n` +
        `— Equipo de Soporte Fullmindtech`;

      await this.metaService.sendTextMessage(phone, message);
      this.logger.log(`Notificación enviada a ${phone} por resolución del ticket ${planeTicketId}`);
    } catch (error: unknown) {
      this.logger.error(
        `Error al notificar resolución del ticket ${planeTicketId}: ${(error as Error).message}`,
      );
    }
  }
}

