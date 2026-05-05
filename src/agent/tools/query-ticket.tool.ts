import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TicketsService } from '../../tickets/tickets.service';
import { CustomersService } from '../../customers/customers.service';

/**
 * Tool: Consultar estado de ticket(s)
 */
export function buildQueryTicketTool(
  ticketsService: TicketsService,
  customersService: CustomersService,
) {
  return createTool({
    id: 'query-ticket',
    description:
      'Consulta el estado actual de un ticket por secuencia o UUID. Tambien puede listar todos los tickets recientes del cliente.',
    inputSchema: z.object({
      ticketId: z
        .string()
        .optional()
        .describe('Numero de secuencia del ticket (ej: "1", "2") o UUID de Plane.'),
      projectId: z
        .string()
        .optional()
        .describe('ID del proyecto del cliente. Disponible en el resultado de validate-customer como projects[0].id. Preferir este sobre customerPhone si ya se valido al cliente.'),
      customerPhone: z
        .string()
        .optional()
        .describe('Telefono del cliente como fallback si no se tiene projectId.'),
      all: z
        .boolean()
        .optional()
        .describe('Si es true, devuelve el estado de todos los tickets recientes del proyecto.'),
    }),
    execute: async (inputData) => {
      const { ticketId, projectId, customerPhone, all } = inputData;

      let resolvedProjectId: string | undefined = projectId;

      if (!resolvedProjectId) {
        if (!customerPhone) {
          return { found: false, message: 'Necesito el projectId del cliente validado o su telefono para consultar tickets.' };
        }
        const customer = await customersService.validateCustomer(customerPhone);
        if (!customer) {
          return { found: false, message: `Cliente con telefono ${customerPhone} no encontrado.` };
        }
        const projects = await customersService.getActiveProjects(customer.id);
        if (projects.length === 0) {
          return { found: false, message: 'No se encontro un proyecto activo para este cliente.' };
        }
        resolvedProjectId = projects[0].id;
      }

      // Wrap project in array for unified handling
      const projectIds = [resolvedProjectId];

      if (all) {
        const lists = await Promise.all(
          projectIds.map((pid) => ticketsService.listTicketStatuses(pid, 20)),
        );
        const tickets = lists.flat().slice(0, 20);
        if (tickets.length === 0) {
          return { found: false, message: 'No hay tickets para este proyecto.' };
        }

        return {
          found: true,
          all: true,
          tickets,
          message: `Encontre ${tickets.length} tickets recientes para este proyecto.`,
        };
      }

      if (!ticketId) {
        return {
          found: false,
          message: 'Para consultar un ticket puntual necesito el numero o ID del ticket.',
        };
      }

      let result: Awaited<ReturnType<typeof ticketsService.getTicketStatus>> | null = null;
      for (const pid of projectIds) {
        const current = await ticketsService.getTicketStatus(ticketId, pid);
        if (current.found) {
          result = current;
          break;
        }
      }

      if (!result?.found) {
        return {
          found: false,
          message: `No se encontro ningun ticket con el ID ${ticketId}. Verifica que el numero sea correcto.`,
        };
      }

      return {
        found: true,
        ticketId: result.sequenceId ?? result.planeTicketId ?? ticketId,
        status: result.status,
        description: result.description,
        message: `Ticket #${result.sequenceId ?? result.planeTicketId}: estado actual ${result.status}.`,
      };
    },
  });
}
