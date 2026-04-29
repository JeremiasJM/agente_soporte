import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { UptimeService } from '../../integrations/uptime/uptime.service';

/**
 * Tool: Verificar estado del servicio en Uptime
 */
export function buildCheckUptimeTool(uptimeService: UptimeService) {
  return createTool({
    id: 'check-uptime',
    description:
      'Verifica el estado actual de los servicios del cliente en el sistema de monitoreo (Uptime). Útil para saber si hay una incidencia activa antes de crear un ticket.',
    inputSchema: z.object({
      serviceName: z
        .string()
        .optional()
        .describe(
          'Nombre parcial del cliente o proyecto. Ej: si el proyecto es "Soporte TechNova 2", pasar "TechNova". Si se omite, retorna todos los servicios.',
        ),
      projectName: z
        .string()
        .optional()
        .describe('Nombre completo del proyecto (disponible en validate-customer → projects[].name). Se extrae el nombre del cliente automáticamente.'),
    }),
    execute: async (inputData) => {
      const { projectName } = inputData;

      // Extraer nombre limpio: "Soporte TechNova 2" → "TechNova"
      // Quita prefijos comunes (Soporte, Sistema, App, Plataforma) y sufijos numéricos
      const rawName = inputData.serviceName ?? projectName ?? '';
      const serviceName = rawName
        ? rawName
            .replace(/^(soporte|sistema|app|plataforma|implementación|tracking)\s+/i, '')
            .replace(/\s+\d+$/, '')
            .trim() || rawName
        : undefined;

      if (serviceName) {
        const status = await uptimeService.getServiceStatus(serviceName);
        return {
          service: status.name,
          status: status.status,
          uptimePercent: status.uptimePercent,
          message:
            status.status === 'up'
              ? `El servicio "${status.name}" está operativo.`
              : status.status === 'down'
                ? `⚠️ El servicio "${status.name}" está CAÍDO. Nuestro equipo está trabajando en ello.`
                : status.status === 'unknown'
                  ? `No se pudo verificar el estado del servicio "${status.name}" (monitoreo no configurado). Continuá con el flujo normal.`
                  : `El servicio "${status.name}" presenta degradación.`,
        };
      }

      const allStatuses = await uptimeService.getAllServicesStatus();
      const downServices = allStatuses.filter((s) => s.status !== 'up');

      return {
        allOperational: downServices.length === 0,
        services: allStatuses,
        summary:
          downServices.length === 0
            ? 'Todos los servicios están operativos.'
            : `Hay ${downServices.length} servicio(s) con incidencias: ${downServices.map((s) => s.name).join(', ')}`,
      };
    },
  });
}
