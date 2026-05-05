import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaneService } from '../integrations/plane/plane.service';
import { AgentConfigService } from '../admin/agent-config.service';

export interface FaqMatch {
  question: string;
  answer: string;
  category?: string | null;
  score: number;
  source: 'plane-page' | 'static';
}

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);
  private readonly faqProjectId: string;

  constructor(
    private readonly planeService: PlaneService,
    private readonly config: ConfigService,
    private readonly agentConfigService: AgentConfigService,
  ) {
    this.faqProjectId = this.config.getOrThrow<string>('PLANE_FAQ_PROJECT_ID');
  }

  /**
   * Busca en la page global de FAQs (proyecto FMTFAQ en Plane).
   */
  async searchFaq(query: string): Promise<FaqMatch | null> {
    return this.searchInProjectPages(this.faqProjectId, query);
  }

  async searchInProjectPages(projectId: string, query: string): Promise<FaqMatch | null> {
    try {
      const pages = await this.planeService.getProjectPages(projectId);
      if (pages.length === 0) return null;

      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3);

      let bestPage: { name: string; content: string; score: number } | null = null;

      for (const page of pages) {
        const content = page.description_stripped ?? '';
        if (!content.trim()) continue;

        const contentLower = content.toLowerCase();
        let score = 0;

        for (const word of queryWords) {
          if (contentLower.includes(word)) score++;
        }
        if (page.name && queryLower.includes(page.name.toLowerCase())) score += 2;
        if (page.name && page.name.toLowerCase().split(/\s+/).some((w) => queryLower.includes(w))) score += 1;

        if (score > 0 && (!bestPage || score > bestPage.score)) {
          bestPage = { name: page.name, content, score };
        }
      }

      if (!bestPage || bestPage.score < 1) return null;

      this.logger.log(`Page match en proyecto ${projectId} (score=${bestPage.score}): "${bestPage.name}"`);
      return {
        question: bestPage.name,
        answer: bestPage.content,
        category: 'proyecto',
        score: bestPage.score,
        source: 'plane-page',
      };
    } catch (error: unknown) {
      this.logger.warn(`Error buscando en pages de ${projectId}: ${(error as Error).message}`);
      return null;
    }
  }

  findBestMatch(query: string): FaqMatch | null {
    const queryLower = query.toLowerCase();
    let bestMatch: FaqMatch | null = null;
    const faqs = this.agentConfigService.getFaqs();

    for (const faq of faqs) {
      let score = 0;

      for (const keyword of faq.keywords) {
        if (queryLower.includes(keyword.toLowerCase())) score++;
      }

      const questionWords = faq.question.toLowerCase().split(/\s+/);
      for (const word of questionWords) {
        if (word.length > 4 && queryLower.includes(word)) score += 0.5;
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          question: faq.question,
          answer: faq.answer,
          category: faq.category ?? null,
          score,
          source: 'static',
        };
      }
    }

    if (!bestMatch || bestMatch.score < 2) return null;

    this.logger.log(`FAQ estatica match (score=${bestMatch.score}): ${bestMatch.question}`);
    return bestMatch;
  }
}
