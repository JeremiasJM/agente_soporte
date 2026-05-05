import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from '@mastra/core/agent';
import { createSupportAgent } from './support-agent';
import {
  ConversationService,
  Channel,
} from '../conversation/conversation.service';
import { CustomersService } from '../customers/customers.service';
import { UptimeService } from '../integrations/uptime/uptime.service';
import { HoursService } from '../hours/hours.service';
import { TicketsService } from '../tickets/tickets.service';
import { FaqService } from '../faq/faq.service';
import { PlaneService } from '../integrations/plane/plane.service';
import { AgentConfigService } from '../admin/agent-config.service';

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);
  private agent!: Agent;

  constructor(
    private readonly config: ConfigService,
    private readonly conversationService: ConversationService,
    private readonly customersService: CustomersService,
    private readonly uptimeService: UptimeService,
    private readonly hoursService: HoursService,
    private readonly ticketsService: TicketsService,
    private readonly faqService: FaqService,
    private readonly planeService: PlaneService,
    private readonly agentConfigService: AgentConfigService,
  ) {}

  onModuleInit(): void {
    this.reloadAgent();
  }

  reloadAgent(): void {
    const llmApiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    const agentConfig = this.agentConfigService.getConfig();
    const llmModel = agentConfig.settings.llmModel;
    const systemPrompt = agentConfig.systemPrompt;

    this.agent = createSupportAgent(
      this.customersService,
      this.uptimeService,
      this.hoursService,
      this.ticketsService,
      this.faqService,
      this.planeService,
      llmApiKey,
      llmModel,
      systemPrompt,
    );

    this.logger.log(`Agente (re)inicializado con modelo: ${llmModel}`);
  }

  /**
   * Procesa un mensaje entrante y retorna la respuesta del agente.
   * Mantiene el historial de la conversación por threadId.
   */
  async processMessage(
    threadId: string,
    channel: Channel,
    userMessage: string,
  ): Promise<string> {
    // Guardar contexto de la sesión
    this.conversationService.getOrCreate(threadId, channel);
    this.conversationService.appendMessage(threadId, 'user', userMessage);

    // Obtener historial para construir el contexto del agente
    const history = this.conversationService.getMessages(threadId);

    // Construir mensajes en formato Mastra
    const messages = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      // Incluir canal, teléfono del cliente y hora actual para que el agente los use directamente
      const now = new Date();
      const horaLocal = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
      const fechaLocal = now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/Buenos_Aires' });
      const enrichedMessage = `[Canal: ${channel}] [Teléfono del cliente: ${threadId}] [Hora local: ${horaLocal} — ${fechaLocal}] ${userMessage}`;

      // Reemplazar el último mensaje user con el enriquecido
      if (messages.length > 0) {
        messages[messages.length - 1] = {
          role: 'user',
          content: enrichedMessage,
        };
      }

      const response = await this.agent.generate(messages, { maxSteps: 10 });

      // Mastra puede incluir texto intermedio (previo a tool calls) en response.text.
      // Estrategia: usar el texto del último step. Si está vacío, usar response.text completo.
      // Si response.text contiene múltiples bloques separados por texto intermedio,
      // tomamos el último párrafo significativo.
      const steps: Array<{ text?: string; toolCalls?: unknown[] }> =
        (response as unknown as { steps?: Array<{ text?: string; toolCalls?: unknown[] }> }).steps ?? [];

      this.logger.debug(`Steps: ${steps.length} | texts: ${steps.map((s) => (s.text ?? '').substring(0, 40)).join(' | ')}`);

      // Tomar el texto del último step (sea o no el que tuvo tool calls)
      const lastStepWithText = steps
        .slice()
        .reverse()
        .find((s) => s.text && s.text.trim());

      const agentReply =
        lastStepWithText?.text?.trim() ??
        response.text ??
        'Lo siento, no pude procesar tu mensaje en este momento.';

      // Guardar respuesta del agente
      this.conversationService.appendMessage(threadId, 'assistant', agentReply);

      return agentReply;
    } catch (error: unknown) {
      this.logger.error(
        `Error al procesar mensaje para ${threadId}: ${(error as Error).message}`,
      );
      return 'Ocurrió un error al procesar tu solicitud. Por favor, intentá de nuevo en unos minutos.';
    }
  }
}
