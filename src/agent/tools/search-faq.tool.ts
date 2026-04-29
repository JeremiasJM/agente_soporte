import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { FaqService } from '../../faq/faq.service';

/**
 * Tool: Buscar respuesta en Pages del proyecto (Plane) o en FAQs estáticas.
 * Primero consulta las páginas del proyecto en Plane (contexto específico del cliente),
 * y si no hay match suficiente, cae a las FAQs estáticas genéricas.
 */
export function buildSearchFaqTool(faqService: FaqService) {
  return createTool({
    id: 'search-faq',
    description:
      'Busca una respuesta a la consulta del cliente. Primero revisa las páginas de documentación del proyecto en Plane (contexto específico), y si no encuentra nada, consulta las FAQs genéricas. Siempre llamar esto ANTES de crear un ticket.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('Descripción o consulta del cliente en lenguaje natural.'),
    }),
    execute: async (inputData) => {
      const { query } = inputData;

      // 1. Buscar en la FAQ global (proyecto FMT Base Conocimiento en Plane)
      const pageMatch = await faqService.searchFaq(query);
      if (pageMatch) {
        return {
          found: true,
          question: pageMatch.question,
          answer: pageMatch.answer,
          category: pageMatch.category,
          source: 'Base de conocimiento Fullmindtech',
        };
      }

      // 2. Fallback a FAQs estáticas genéricas
      const staticMatch = faqService.findBestMatch(query);
      if (!staticMatch) {
        return {
          found: false,
          message: 'No se encontró una respuesta automática. Crear ticket.',
        };
      }

      return {
        found: true,
        question: staticMatch.question,
        answer: staticMatch.answer,
        category: staticMatch.category,
        source: 'Base de conocimiento general',
      };
    },
  });
}
