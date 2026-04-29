export interface CreatePlaneTicketDto {
  name: string;
  description: string;
  customerId: string;
  projectName: string;
  channel: string;
  isOverage: boolean;
  /** ID del proyecto donde se crea el issue. Si no se provee, usa PLANE_PROJECT_ID del .env */
  planeProjectId?: string;
  /** Clasificación del ticket: intención, tipo y subtipo */
  intencion?: string;
  tipo?: string;
  subtipo?: string;
  confianza?: number;
}

export interface PlaneTicket {
  id: string;
  sequence_id: number;
  name: string;
  description_html?: string;
  /** UUID del estado — presente en respuestas de lista */
  state?: string;
  /** Detalle del estado — presente en respuesta de issue individual */
  state_detail?: {
    id?: string;
    name: string;
    group: string;
  };
  created_at: string;
  updated_at: string;
}

export interface PlaneState {
  id: string;
  name: string;
  group: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
}

/** Respuesta del endpoint de intake de Plane */
export interface PlaneIntakeIssueResponse {
  id: string;
  issue: PlaneTicket;
  status: number;
  source?: string;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface PlaneCustomer {
  id: string;
  name: string;
  email?: string;
  /** Usamos website_url como campo para el número WhatsApp (+549XXXXXXXXXX) */
  website_url?: string;
  domain?: string;
  contract_status?: string;
  stage?: string;
  description_stripped?: string;
  customer_request_count?: number;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface PlaneProjectRaw {
  id: string;
  name: string;
  identifier?: string;
  description?: string;
  estimate?: string | null;
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export interface PlaneEstimate {
  id: string;
  name: string;
  type: 'categories' | 'points' | 'time';
  last_used: boolean;
}

export interface PlaneEstimatePoint {
  id: string;
  key: number;
  value: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Tipo enriquecido para el agente
// ---------------------------------------------------------------------------

/**
 * Proyecto con información de horas de soporte calculada desde el estimate de Plane.
 *
 * Convención de horas:
 *   - contractedMinutes = valor máximo del estimate del proyecto (= paquete contratado)
 *   - usedMinutes       = suma de estimate_point.value de todos los issues del mes con estimate asignado
 *   - isOverage         = usedMinutes > contractedMinutes
 */
export interface PlaneProjectWithHours {
  id: string;
  name: string;
  /** Descripción completa del proyecto en Plane (contiene contexto, app, pasos de resolución) */
  description?: string;
  estimateId?: string;
  estimateType?: string;
  contractedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  isOverage: boolean;
  estimatePoints: PlaneEstimatePoint[];
}

// ---------------------------------------------------------------------------
// Pages (contexto/FAQ del proyecto)
// ---------------------------------------------------------------------------

export interface PlaneProjectPage {
  id: string;
  name: string;
  description_stripped?: string;
  description_html?: string;
  created_at: string;
}
