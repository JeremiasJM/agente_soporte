import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CustomersService } from '../../customers/customers.service';
import { PlaneService } from '../../integrations/plane/plane.service';

/**
 * Tool: Validar cliente
 * Verifica si el cliente existe por teléfono o por código+PIN cuando el teléfono no matchea.
 */
export function buildValidateCustomerTool(
  customersService: CustomersService,
  planeService: PlaneService,
) {
  return createTool({
    id: 'validate-customer',
    description:
      'Valida si un cliente existe y está activo en Plane. Primero intenta por teléfono automáticamente. Si no matchea, puede validar con código de cliente + PIN. Retorna datos del cliente y proyectos con horas.',
    inputSchema: z.object({
      identifier: z
        .string()
        .describe(
          'Número de teléfono a validar. Usar primero el valor de [Teléfono del cliente:...] del contexto. Si el cliente indicó un número diferente en la conversación, usar ese número alternativo en su lugar.',
        ),
      clientCode: z
        .string()
        .optional()
        .describe('Código de cliente (ej: ABC123) si el teléfono no está registrado.'),
      pin: z
        .string()
        .optional()
        .describe('PIN de seguridad del cliente, requerido junto con clientCode.'),
    }),
    execute: async (inputData) => {
      const { identifier, clientCode, pin } = inputData;

      // 1. Intento normal por teléfono
      let customer = await customersService.validateCustomer(identifier);

      // 2. Teléfono no registrado — flujo código + PIN
      if (!customer) {
        // 2a. Sin código → pedir código con explicación de qué es
        if (!clientCode) {
          return {
            valid: false,
            requiresClientCode: true,
            phoneChecked: identifier,
            message:
              'Teléfono no registrado. Opciones: (1) El cliente puede dar otro número con el que se contrató el servicio. (2) Puede dar su código de cliente (ej: TN-001, RP-001) — fue entregado por Fullmindtech al inicio del contrato. (3) Si no tiene el código, debe contactar a soporte@fullmindtech.com.ar.',
          };
        }
        // 2b. Código presente pero sin PIN → pedir PIN (nunca intentar sin él)
        if (!pin) {
          return {
            valid: false,
            requiresPin: true,
            message: `Código de cliente recibido. Ahora solicitá el **PIN de seguridad** para verificar la identidad.`,
          };
        }
        // 2c. Código + PIN → validar
        const project = await planeService.findProjectByClientCode(clientCode, pin);
        if (project) {
          const clientName = planeService.parseClientNameFromDescription(project.description);
          const phone = planeService.parsePhoneFromDescription(project.description);
          customer = {
            id: project.id,
            name: clientName,
            website_url: phone ?? identifier,
            contract_status: 'active',
          };
        } else {
          return {
            valid: false,
            message: 'Código de cliente o PIN incorrecto. Verificá los datos e intentá de nuevo.',
          };
        }
      }

      const projects = await customersService.getActiveProjects(customer.id);

      return {
        valid: true,
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.website_url,
          email: customer.email,
          contractStatus: customer.contract_status,
        },
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          contractedMinutes: p.contractedMinutes,
          usedMinutes: p.usedMinutes,
          remainingMinutes: p.remainingMinutes,
          isOverage: p.isOverage,
          projectContext: p.description ?? null,
        })),
        message:
          projects.length === 0
            ? `✅ Cliente "${customer.name}" validado, pero sin proyectos con plan de soporte activo en Plane.`
            : `✅ Cliente "${customer.name}" validado. Proyectos con soporte: ${projects.map((p) => p.name).join(', ')}.`,
      };
    },
  });
}
