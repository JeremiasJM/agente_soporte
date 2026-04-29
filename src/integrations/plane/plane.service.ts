import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  CreatePlaneTicketDto,
  PlaneCustomer,
  PlaneEstimate,
  PlaneEstimatePoint,
  PlaneIntakeIssueResponse,
  PlaneProjectPage,
  PlaneProjectRaw,
  PlaneProjectWithHours,
  PlaneState,
  PlaneTicket,
} from './dto/plane-ticket.dto';

interface PlaneListResponse<T> {
  results: T[];
  total_results?: number;
  count?: number;
}

interface PlaneIssueRaw {
  id: string;
  sequence_id?: number;
  name: string;
  state_id?: string;
  priority?: string;
  estimate_point?: string | null;
  created_at?: string;
  project_id?: string;
}

interface PlaneIssueListResponse {
  results: PlaneTicket[];
  next?: string | null;
}

@Injectable()
export class PlaneService {
  private readonly logger = new Logger(PlaneService.name);
  private readonly http: AxiosInstance;
  private readonly workspaceSlug: string;
  private readonly fallbackProjectId: string;

  constructor(private readonly config: ConfigService) {
    this.workspaceSlug = this.config.getOrThrow<string>('PLANE_WORKSPACE_SLUG');
    // Opcional: usado solo como fallback si no se pasa planeProjectId al crear un ticket
    this.fallbackProjectId = this.config.get<string>('PLANE_PROJECT_ID', '');

    this.http = axios.create({
      baseURL: this.config.get<string>('PLANE_API_URL', 'https://api.plane.so/api/v1'),
      headers: {
        'X-API-Key': this.config.getOrThrow<string>('PLANE_API_KEY'),
        'Content-Type': 'application/json',
      },
    });
  }

  // ─── Tickets / Issues ─────────────────────────────────────────────────────

  /**
   * Crea un ticket como Intake en Plane y retorna la info básica del ticket creado.
   * Usa el endpoint /intake/issues/ para que aparezca en la bandeja de triage.
   */
  async createTicket(dto: CreatePlaneTicketDto): Promise<PlaneTicket> {
    const overageNote = dto.isOverage
      ? '\n\n⚠️ **HORA EXCEDENTE:** Este ticket fue creado con horas de soporte agotadas.'
      : '';

    const classificationNote = dto.tipo
      ? `\n**Clasificación:** ${dto.intencion ?? 'problema'} › ${dto.tipo}${dto.subtipo ? ' › ' + dto.subtipo : ''}${dto.confianza !== undefined ? ` (confianza: ${Math.round(dto.confianza * 100)}%)` : ''}`
      : '';

    const description = [
      `**Cliente:** ${dto.customerId}`,
      `**Proyecto:** ${dto.projectName}`,
      `**Canal de origen:** ${dto.channel}`,
      classificationNote,
      '',
      dto.description,
      overageNote,
    ].join('\n');

    const targetProjectId = dto.planeProjectId ?? this.fallbackProjectId;
    if (!targetProjectId) {
      throw new Error('No se definió un proyecto destino para el ticket. Configurá PLANE_PROJECT_ID o pasá planeProjectId en el DTO.');
    }

    const response = await this.http.post<PlaneTicket>(
      `/workspaces/${this.workspaceSlug}/projects/${targetProjectId}/issues/`,
      {
        name: dto.name,
        description_html: `<p>${description.replace(/\n/g, '<br/>')}</p>`,
      },
    );

    this.logger.log(`Ticket creado en Plane: ${response.data.id} (seq: ${response.data.sequence_id})`);
    return response.data;
  }

  /**
   * Obtiene el estado de un ticket en Plane con state_detail completo.
   * Si ticketId es un número, busca por sequence_id y luego fetcha el issue individual.
   * Si ticketId es un UUID, busca directamente.
   *
   * IMPORTANTE: el list endpoint no incluye state_detail — siempre se hace
   * un segundo GET por UUID para obtener el estado real del ticket.
   */
  async getTicket(ticketId: string, projectId?: string): Promise<PlaneTicket> {
    const resolvedProjectId = projectId ?? this.fallbackProjectId;
    if (!resolvedProjectId) {
      throw new Error('No se puede consultar el ticket sin projectId');
    }

    // Si es número, buscar por sequence_id en el listado y luego fetchear individualmente
    const isSequenceId = /^\d+$/.test(ticketId.trim());
    if (isSequenceId) {
      const sequenceId = Number(ticketId.trim());
      const res = await this.http.get<PlaneIssueListResponse>(
        `/workspaces/${this.workspaceSlug}/projects/${resolvedProjectId}/issues/`,
        { params: { per_page: 100 } },
      );

      const found = (res.data.results ?? []).find((issue) => issue.sequence_id === sequenceId);
      if (!found) throw new Error(`Ticket #${ticketId} no encontrado`);

      // Fetch individual para obtener state_detail completo (no incluido en listas)
      const detail = await this.http.get<PlaneTicket>(
        `/workspaces/${this.workspaceSlug}/projects/${resolvedProjectId}/issues/${found.id}/`,
      );
      return detail.data;
    }

    // UUID directo — la respuesta incluye state_detail
    const response = await this.http.get<PlaneTicket>(
      `/workspaces/${this.workspaceSlug}/projects/${resolvedProjectId}/issues/${ticketId}/`,
    );
    return response.data;
  }

  /**
   * Lista tickets de un proyecto enriquecidos con state_detail.
   * El list endpoint de Plane devuelve `state` (UUID) pero no `state_detail`.
   * Se resuelve fetcheando los states del proyecto y haciendo join local.
   */
  async listProjectTickets(projectId: string, limit = 20): Promise<PlaneTicket[]> {
    const [issuesRes, states] = await Promise.all([
      this.http.get<PlaneIssueListResponse>(
        `/workspaces/${this.workspaceSlug}/projects/${projectId}/issues/`,
        { params: { per_page: Math.min(Math.max(limit, 1), 100) } },
      ),
      this.getProjectStates(projectId),
    ]);

    const stateMap = new Map(states.map((s) => [s.id, s]));
    const tickets = issuesRes.data.results ?? [];

    return tickets.map((ticket) => {
      if (!ticket.state_detail && ticket.state) {
        const state = stateMap.get(ticket.state);
        if (state) {
          return { ...ticket, state_detail: { id: state.id, name: state.name, group: state.group } };
        }
      }
      return ticket;
    });
  }

  /** Fetcha los estados de un proyecto. Cacheado 5 min por projectId. */
  private statesCache = new Map<string, { data: PlaneState[]; at: number }>();

  async getProjectStates(projectId: string): Promise<PlaneState[]> {
    const TTL = 5 * 60 * 1000;
    const cached = this.statesCache.get(projectId);
    if (cached && Date.now() - cached.at < TTL) return cached.data;

    try {
      const res = await this.http.get<{ results: PlaneState[] }>(
        `/workspaces/${this.workspaceSlug}/projects/${projectId}/states/`,
      );
      const data = res.data.results ?? [];
      this.statesCache.set(projectId, { data, at: Date.now() });
      return data;
    } catch {
      return [];
    }
  }

  /**
   * Obtiene todos los tickets recientes de un proyecto.
   * Usado para polling del estado de resolución.
   */
  async getResolvedTickets(since?: Date): Promise<PlaneTicket[]> {
    const params: Record<string, string> = {
      state_group: 'done',
    };
    if (since) {
      params['updated_at__gte'] = since.toISOString();
    }

    const response = await this.http.get<{ results: PlaneTicket[] }>(
      `/workspaces/${this.workspaceSlug}/projects/${this.fallbackProjectId}/issues/`,
      { params },
    );

    return response.data.results ?? [];
  }

  // ─── Customers ──────────────────────────────────────────────────────────

  /**
   * Lista todos los customers del workspace.
   * Resultados cacheados en memoria por 5 minutos para reducir llamadas a la API.
   */
  private customersCache: { data: PlaneCustomer[]; at: number } | null = null;

  async listAllCustomers(): Promise<PlaneCustomer[]> {
    const TTL = 5 * 60 * 1000;
    if (this.customersCache && Date.now() - this.customersCache.at < TTL) {
      return this.customersCache.data;
    }
    const res = await this.http.get<PlaneListResponse<PlaneCustomer>>(
      `/workspaces/${this.workspaceSlug}/customers/`,
      { params: { per_page: 100 } },
    );
    const data = res.data.results ?? [];
    this.customersCache = { data, at: Date.now() };
    return data;
  }

  // ─── Lookup por teléfono en descripción de proyecto ─────────────────────

  /**
   * Parsea el teléfono desde la descripción del proyecto.
   * Formato esperado: "Teléfono: +5491XXXXXXXXX" (con o sin tilde, espacios, guiones).
   */
  parsePhoneFromDescription(description?: string): string | null {
    if (!description) return null;
    const match = description.match(/tel[eé]fono\s*:\s*(\+?[\d\s\-]{8,20})/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Parsea el nombre del cliente desde la descripción del proyecto.
   * Formato esperado: "Cliente: NombreEmpresa"
   */
  parseClientNameFromDescription(description?: string): string {
    if (!description) return 'Cliente';
    const match = description.match(/cliente\s*:\s*(.+)/i);
    return match ? match[1].trim() : 'Cliente';
  }

  /**
   * Parsea el código de cliente desde la descripción del proyecto.
   * Formato esperado: "Codigo: ABC123" o "Código de cliente: ABC123"
   */
  parseClientCodeFromDescription(description?: string): string | null {
    if (!description) return null;
    const match = description.match(/c[oó]digo(?:\s+de\s+cliente)?\s*:\s*([A-Za-z0-9\-_]+)/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Parsea el PIN de seguridad desde la descripción del proyecto.
   * Formato esperado: "PIN: 1234"
   */
  parsePinFromDescription(description?: string): string | null {
    if (!description) return null;
    const match = description.match(/pin\s*:\s*([A-Za-z0-9]{3,10})/i);
    return match ? match[1].trim() : null;
  }

  /**
   * Busca un proyecto cuya descripción contenga el número de teléfono indicado.
   * Normaliza el número quitando +, espacios y guiones antes de comparar.
   */
  async findProjectByPhone(phone: string): Promise<PlaneProjectRaw | null> {
    const projects = await this.listAllProjects();
    const normalize = (s: string) => s.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');
    const cleanPhone = normalize(phone);

    return (
      projects.find((p) => {
        const descPhone = this.parsePhoneFromDescription(p.description);
        return descPhone ? normalize(descPhone) === cleanPhone : false;
      }) ?? null
    );
  }

  /**
   * Busca un proyecto por código de cliente y valida el PIN si se provee.
   * Formato en descripción: "Codigo: ABC123" y "PIN: 1234"
   */
  async findProjectByClientCode(
    clientCode: string,
    pin?: string,
  ): Promise<PlaneProjectRaw | null> {
    const projects = await this.listAllProjects();
    const normalizeCode = (s: string) => s.trim().toLowerCase();

    const project = projects.find((p) => {
      const code = this.parseClientCodeFromDescription(p.description);
      return code ? normalizeCode(code) === normalizeCode(clientCode) : false;
    }) ?? null;

    if (!project) return null;

    // Si se requiere PIN, validarlo
    if (pin !== undefined) {
      const storedPin = this.parsePinFromDescription(project.description);
      if (storedPin && storedPin.toLowerCase() !== pin.trim().toLowerCase()) {
        this.logger.warn(`PIN incorrecto para código ${clientCode}`);
        return null;
      }
    }

    return project;
  }

  /**
   * Retorna un único proyecto enriquecido con horas (usado cuando el projectId
   * ya es conocido, por ejemplo después de findProjectByPhone).
   */
  async getProjectWithHours(projectId: string): Promise<PlaneProjectWithHours | null> {
    const allProjects = await this.listAllProjects();
    const project = allProjects.find((p) => p.id === projectId);
    if (!project) return null;

    const contractedMinutes = this.parseContractedHoursFromDescription(project.description);
    if (contractedMinutes === 0) return null;

    const usedMinutes = await this.calculateUsedMinutesThisMonth(projectId, []);

    return {
      id: projectId,
      name: project.name,
      description: project.description,
      contractedMinutes,
      usedMinutes,
      remainingMinutes: Math.max(0, contractedMinutes - usedMinutes),
      isOverage: usedMinutes >= contractedMinutes,
      estimatePoints: [],
    };
  }

  /**
   * Busca un customer por número de WhatsApp (campo website_url) o por ID.
   * Mantenido como fallback para búsquedas por email o ID de customer de Plane.
   */
  async findCustomer(identifier: string): Promise<PlaneCustomer | null> {
    const customers = await this.listAllCustomers();
    // Normaliza: extrae el número de URLs tipo https://wa.me/5491XXXXXXXXX
    const extractPhone = (url?: string | null): string =>
      url?.replace(/^https:\/\/wa\.me\//, '+') ?? '';
    // Normaliza el identificador de entrada: quita el + inicial para comparar desnudo
    const normalizeNum = (s: string) => s.replace(/^\+/, '');

    return (
      customers.find((c) => {
        const phoneFromUrl = extractPhone(c.website_url);
        return (
          c.id === identifier ||
          c.website_url === identifier ||
          phoneFromUrl === identifier ||
          normalizeNum(phoneFromUrl) === normalizeNum(identifier) ||
          (c.email && c.email.toLowerCase() === identifier.toLowerCase())
        );
      }) ?? null
    );
  }

  // ─── Proyectos y Estimates ───────────────────────────────────────────────

  /**
   * Lista todos los proyectos del workspace.
   */
  async listAllProjects(): Promise<PlaneProjectRaw[]> {
    const res = await this.http.get<PlaneListResponse<PlaneProjectRaw>>(
      `/workspaces/${this.workspaceSlug}/projects/`,
      { params: { per_page: 100 } },
    );
    return res.data.results ?? [];
  }

  /**
   * Retorna el estimate configurado en un proyecto (null si no tiene).
   */
  private async getProjectEstimate(projectId: string): Promise<PlaneEstimate | null> {
    try {
      const res = await this.http.get<PlaneEstimate>(
        `/workspaces/${this.workspaceSlug}/projects/${projectId}/estimates/`,
      );
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Retorna los estimate points de un estimate.
   */
  private async getEstimatePoints(
    projectId: string,
    estimateId: string,
  ): Promise<PlaneEstimatePoint[]> {
    try {
      const res = await this.http.get<PlaneEstimatePoint[]>(
        `/workspaces/${this.workspaceSlug}/projects/${projectId}/estimates/${estimateId}/estimate-points/`,
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  /**
   * Retorna los IDs únicos de proyectos que aparecen en los work items de un customer.
   */
  async getCustomerProjectIds(customerId: string): Promise<string[]> {
    try {
      const res = await this.http.get<PlaneListResponse<PlaneIssueRaw> | PlaneIssueRaw[]>(
        `/workspaces/${this.workspaceSlug}/customers/${customerId}/issues/`,
        { params: { per_page: 100 } },
      );
      const items: PlaneIssueRaw[] = Array.isArray(res.data)
        ? res.data
        : (res.data as PlaneListResponse<PlaneIssueRaw>).results ?? [];
      const ids = [...new Set(items.map((i) => i.project_id).filter(Boolean))] as string[];
      return ids;
    } catch {
      return [];
    }
  }

  /**
   * Parsea las horas contratadas desde la descripción del proyecto.
   * Formato esperado en la descripción: "Plan Horas de Soporte: Xhs" o "Plan Horas de Soporte: X hs"
   * Retorna los minutos (horas * 60). Si no encuentra el patrón, retorna 0.
   */
  private parseContractedHoursFromDescription(description?: string): number {
    if (!description) return 0;
    // Acepta: "Plan Horas de Soporte: 5hs", "plan horas de soporte: 10 hs", "Plan Soporte: 2h", etc.
    const match = description.match(/plan\s+horas?\s+de\s+soporte\s*:\s*(\d+(?:\.\d+)?)\s*h/i);
    if (!match) return 0;
    return Math.round(parseFloat(match[1]) * 60);
  }

  /**
   * Retorna los proyectos de un customer enriquecidos con información de horas.
   *
   * **Nueva convención (sin estimates):**
   *   - contractedMinutes = parseado desde la descripción del proyecto → "Plan Horas de Soporte: 5hs"
   *   - usedMinutes       = suma de estimate_point.value de issues del MES ACTUAL con estimate asignado
   *   - Solo proyectos que tienen "Plan Horas de Soporte" en la descripción son considerados de soporte.
   */
  async getCustomerProjectsWithHours(customerId: string): Promise<PlaneProjectWithHours[]> {
    const projectIds = await this.getCustomerProjectIds(customerId);
    if (projectIds.length === 0) return [];

    const allProjects = await this.listAllProjects();
    const result: PlaneProjectWithHours[] = [];

    for (const projectId of projectIds) {
      const project = allProjects.find((p) => p.id === projectId);
      if (!project) continue;

      const contractedMinutes = this.parseContractedHoursFromDescription(project.description);
      if (contractedMinutes === 0) continue; // no es un proyecto de soporte

      // Horas usadas este mes (usando estimate points si existen, si no → 0)
      const usedMinutes = await this.calculateUsedMinutesThisMonth(projectId, []);

      result.push({
        id: projectId,
        name: project.name,
        description: project.description,
        contractedMinutes,
        usedMinutes,
        remainingMinutes: Math.max(0, contractedMinutes - usedMinutes),
        isOverage: usedMinutes >= contractedMinutes,
        estimatePoints: [],
      });
    }

    return result;
  }

  /**
   * Suma los minutos usados en el mes actual para un proyecto.
   * Cuenta issues con estimate_point asignado creados en el mes en curso.
   * Si estimatePoints está vacío, intenta leer los points del proyecto.
   */
  async calculateUsedMinutesThisMonth(
    projectId: string,
    estimatePoints: PlaneEstimatePoint[],
  ): Promise<number> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const res = await this.http.get<PlaneListResponse<PlaneIssueRaw>>(
        `/workspaces/${this.workspaceSlug}/projects/${projectId}/issues/`,
        { params: { per_page: 100, created_at__gte: startOfMonth } },
      );

      const issues = res.data.results ?? [];

      // Si no tenemos un mapa de points, contamos cada issue con estimate_point como 1 hora (60 min)
      if (estimatePoints.length === 0) {
        return issues.filter((i) => i.estimate_point).length * 60;
      }

      const pointMap = new Map(estimatePoints.map((p) => [p.id, parseInt(p.value, 10) || 0]));
      return issues
        .filter((i) => i.estimate_point)
        .reduce((sum, i) => sum + (pointMap.get(i.estimate_point!) ?? 60), 0);
    } catch {
      return 0;
    }
  }

  /**
   * Obtiene las páginas (documentación/FAQ) de un proyecto de Plane.
   * Cada página puede contener contexto del proyecto o preguntas frecuentes.
   */
  async getProjectPages(projectId: string): Promise<PlaneProjectPage[]> {
    try {
      const res = await this.http.get<PlaneListResponse<PlaneProjectPage>>(
        `/workspaces/${this.workspaceSlug}/projects/${projectId}/pages/`,
        { params: { per_page: 50 } },
      );
      return res.data.results ?? [];
    } catch (error: unknown) {
      this.logger.warn(`No se pudieron obtener páginas del proyecto ${projectId}: ${(error as Error).message}`);
      return [];
    }
  }
}
