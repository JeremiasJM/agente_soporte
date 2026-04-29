import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaneService } from '../integrations/plane/plane.service';

export interface FaqMatch {
  question: string;
  answer: string;
  category?: string | null;
  score: number;
  source: 'plane-page' | 'static';
}

interface FaqEntry {
  keywords: string[];
  question: string;
  answer: string;
  category?: string;
}

const STATIC_FAQS: FaqEntry[] = [
  {
    keywords: ['contrasena', 'password', 'clave', 'olvide', 'restablecer', 'reset'],
    question: 'Como restablezco mi contrasena?',
    answer: 'Para restablecer tu contrasena, hace clic en "Olvide mi contrasena" en la pantalla de login. Recibiras un email con un enlace para crear una nueva clave. Si no recibes el email, verifica la carpeta de spam.',
    category: 'acceso',
  },
  {
    keywords: ['no puedo', 'no abre', 'error', 'no carga', 'pantalla', 'blanco', 'cuelga'],
    question: 'La aplicacion no abre o se congela',
    answer: 'Para resolver problemas de apertura o congelamiento:\n1. Cerra completamente la aplicacion\n2. Limpia el cache del navegador (Ctrl+Shift+Del)\n3. Intenta desde otro navegador o dispositivo\n4. Si el problema persiste, puede ser un problema del servidor.',
    category: 'rendimiento',
  },
  {
    keywords: ['lento', 'tarda', 'demora', 'rendimiento', 'performance'],
    question: 'El sistema responde muy lento',
    answer: 'Si el sistema esta lento: verifica tu conexion a internet, limpia el cache del navegador, y cerra pestanas innecesarias. Si la lentitud es generalizada, puede ser un problema del servidor que el equipo ya esta monitoreando.',
    category: 'rendimiento',
  },
  {
    keywords: ['factura', 'facturacion', 'facturar', 'comprobante', 'afip'],
    question: 'No puedo emitir facturas o hay un error con AFIP',
    answer: 'Problemas de facturacion suelen relacionarse con el certificado AFIP vencido. Verifica en Configuracion -> AFIP que el certificado este vigente. Si persiste, creamos el ticket para que el equipo tecnico lo revise.',
    category: 'facturacion',
  },
  {
    keywords: ['login', 'sesion', 'ingresar', 'acceder', 'usuario', 'no entra'],
    question: 'No puedo iniciar sesion',
    answer: 'Si no podes ingresar: verifica que Caps Lock este desactivado, proba con "Olvide mi contrasena", o limpia las cookies del navegador. Si el usuario fue bloqueado, nuestro equipo puede desbloquearlo.',
    category: 'acceso',
  },
  {
    keywords: ['datos', 'perdi', 'borro', 'desaparecio', 'backup', 'recuperar'],
    question: 'Perdi datos o informacion del sistema',
    answer: 'Para recuperacion de datos es necesario que un tecnico revise los logs. Creamos el ticket con prioridad alta para que el equipo lo atienda a la brevedad. No realices cambios en el sistema hasta que te contactemos.',
    category: 'datos',
  },
];

@Injectable()
export class FaqService {
  private readonly logger = new Logger(FaqService.name);
  private readonly faqProjectId: string;

  constructor(
    private readonly planeService: PlaneService,
    private readonly config: ConfigService,
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

    for (const faq of STATIC_FAQS) {
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
