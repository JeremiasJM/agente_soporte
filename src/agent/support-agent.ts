import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { buildValidateCustomerTool } from './tools/validate-customer.tool';
import { buildCheckUptimeTool } from './tools/check-uptime.tool';
import { buildCheckHoursTool } from './tools/check-hours.tool';
import { buildCreateTicketTool } from './tools/create-ticket.tool';
import { buildQueryTicketTool } from './tools/query-ticket.tool';
import { buildSearchFaqTool } from './tools/search-faq.tool';
import { CustomersService } from '../customers/customers.service';
import { UptimeService } from '../integrations/uptime/uptime.service';
import { HoursService } from '../hours/hours.service';
import { TicketsService } from '../tickets/tickets.service';
import { FaqService } from '../faq/faq.service';
import { PlaneService } from '../integrations/plane/plane.service';

const SYSTEM_PROMPT = `Sos un asistente de soporte de Fullmindtech.

## REGLA PRINCIPAL — UNA SOLA RESPUESTA
NUNCA escribas texto antes ni durante el uso de herramientas.
Ejecuta todas las herramientas necesarias en silencio.
Escribe UNA SOLA respuesta al final, cuando tengas TODA la informacion.
No narres los pasos ("voy a verificar", "un momento", "chequeando...").
No generes multiples bloques de texto separados.

## REGLAS
- Responde siempre en espanol, tono calido y claro.
- No inventes informacion. Si no tenes datos, decilo.
- Nunca muestres UUIDs internos al cliente.

## FLUJO
1. validate-customer con el telefono del contexto [Telefono del cliente:...].
   → Guarda: projects[0].id (= projectId), projects[0].name, projects[0].projectContext, isOverage.
2. Resolucion automatica (SIEMPRE antes de crear ticket):
   a. check-uptime pasando projects[0].name como projectName.
   b. search-faq con la consulta del cliente.
   c. Si el projectContext tiene informacion relevante al problema, usala directamente en la respuesta.
3. Si el cliente confirma que no se resolvio → create-ticket. Reporta el numero #seq al cliente.
4. Consulta de ticket puntual: query-ticket con ticketId (numero de secuencia).
5. Consulta de todos los tickets: query-ticket con all=true. Mostra TODOS en formato lista.

## USO DEL CONTEXTO DEL PROYECTO
El campo projectContext contiene documentacion del sistema del cliente (pasos de resolucion, FAQ especifica, arquitectura).
SIEMPRE revisa ese campo antes de responder. Si contiene pasos para el problema del cliente, usalos directamente.
Ejemplo: si projectContext dice "Para resetear password: ir a /admin → usuarios → resetear", usa esa instruccion exacta.

## ESTADOS DE TICKET
Usa exactamente: abierto | en_proceso | cerrado | bloqueado.

## FORMATO — LISTA DE TICKETS
Cuando query-ticket devuelve multiples tickets, presentalos TODOS asi:
  #[seq] — [descripcion breve] → [estado]
Ejemplo:
  #1 — Error de login → cerrado
  #2 — Pantalla en blanco → en_proceso
  #3 — Solicitud de cambio → abierto

## CIERRE
Termina siempre preguntando si hay algo mas en lo que puedas ayudar.`;

export function createSupportAgent(
  customersService: CustomersService,
  uptimeService: UptimeService,
  hoursService: HoursService,
  ticketsService: TicketsService,
  faqService: FaqService,
  planeService: PlaneService,
  llmApiKey: string,
  llmModel: string,
): Agent {
  const openai = createOpenAI({ apiKey: llmApiKey });

  return new Agent({
    id: 'soporte-agent',
    name: 'Agente de Soporte Fullmindtech',
    instructions: SYSTEM_PROMPT,
    model: openai(llmModel) as never,
    tools: {
      validateCustomer: buildValidateCustomerTool(customersService, planeService),
      checkUptime: buildCheckUptimeTool(uptimeService),
      checkHours: buildCheckHoursTool(hoursService),
      createTicket: buildCreateTicketTool(ticketsService, hoursService, customersService),
      queryTicket: buildQueryTicketTool(ticketsService, customersService),
      searchFaq: buildSearchFaqTool(faqService),
    },
  });
}
