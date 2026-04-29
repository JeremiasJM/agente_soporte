import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PlaneService } from './plane.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeMockHttp() {
  return {
    get: jest.fn(),
    post: jest.fn(),
  };
}

function makePlaneService(overrides?: Partial<ConfigService>) {
  const config = {
    getOrThrow: (key: string) => {
      const vals: Record<string, string> = {
        PLANE_API_KEY: 'test-key',
        PLANE_WORKSPACE_SLUG: 'test-ws',
      };
      return vals[key] ?? (() => { throw new Error(`Missing ${key}`); })();
    },
    get: (key: string, def?: string) => {
      const vals: Record<string, string> = {
        PLANE_API_URL: 'https://api.plane.so/api/v1',
        PLANE_PROJECT_ID: 'fallback-proj',
      };
      return vals[key] ?? def;
    },
    ...overrides,
  } as unknown as ConfigService;

  const http = makeMockHttp();
  mockedAxios.create = jest.fn().mockReturnValue(http);

  const service = new PlaneService(config);
  // Inyectar http mock directamente
  (service as any).http = http;

  return { service, http };
}

describe('PlaneService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getTicket por sequence_id ─────────────────────────────────────────────

  describe('getTicket — por sequence_id', () => {
    it('fetcha lista y luego individual para obtener state_detail', async () => {
      const { service, http } = makePlaneService();

      // Primera llamada: list con resultados
      http.get
        .mockResolvedValueOnce({
          data: {
            results: [
              { id: 'uuid-abc', sequence_id: 3, name: 'Test', state: 'state-uuid-1', created_at: '', updated_at: '' },
            ],
          },
        })
        // Segunda llamada: individual con state_detail
        .mockResolvedValueOnce({
          data: {
            id: 'uuid-abc',
            sequence_id: 3,
            name: 'Test',
            state_detail: { name: 'In Progress', group: 'started' },
            created_at: '',
            updated_at: '',
          },
        });

      const ticket = await service.getTicket('3', 'proj-1');

      expect(http.get).toHaveBeenCalledTimes(2);
      // Primera: list
      expect(http.get.mock.calls[0][0]).toContain('/issues/');
      expect(http.get.mock.calls[0][1]).toMatchObject({ params: { per_page: 100 } });
      // Segunda: individual por UUID
      expect(http.get.mock.calls[1][0]).toContain('/issues/uuid-abc/');

      expect(ticket.state_detail?.name).toBe('In Progress');
    });

    it('lanza error si sequence_id no existe en el proyecto', async () => {
      const { service, http } = makePlaneService();

      http.get.mockResolvedValueOnce({ data: { results: [] } });

      await expect(service.getTicket('99', 'proj-1')).rejects.toThrow('Ticket #99 no encontrado');
    });
  });

  // ── getTicket por UUID ───────────────────────────────────────────────────

  describe('getTicket — por UUID', () => {
    it('fetcha directamente sin pasar por lista', async () => {
      const { service, http } = makePlaneService();

      http.get.mockResolvedValueOnce({
        data: {
          id: 'uuid-direct',
          sequence_id: 7,
          name: 'Direct fetch',
          state_detail: { name: 'Done', group: 'completed' },
          created_at: '',
          updated_at: '',
        },
      });

      const ticket = await service.getTicket('uuid-direct', 'proj-1');

      expect(http.get).toHaveBeenCalledTimes(1);
      expect(http.get.mock.calls[0][0]).toContain('/issues/uuid-direct/');
      expect(ticket.state_detail?.name).toBe('Done');
    });
  });

  // ── listProjectTickets — enriquecimiento con states ──────────────────────

  describe('listProjectTickets', () => {
    it('enriquece tickets con state_detail desde states del proyecto', async () => {
      const { service, http } = makePlaneService();

      // Paralelo: issues + states
      http.get
        .mockResolvedValueOnce({
          data: {
            results: [
              { id: 'uuid-1', sequence_id: 1, name: 'Error login', state: 'state-done', created_at: '', updated_at: '' },
              { id: 'uuid-2', sequence_id: 2, name: 'Pantalla blanca', state: 'state-progress', created_at: '', updated_at: '' },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: {
            results: [
              { id: 'state-done', name: 'Done', group: 'completed' },
              { id: 'state-progress', name: 'In Progress', group: 'started' },
            ],
          },
        });

      const tickets = await service.listProjectTickets('proj-1', 20);

      expect(tickets).toHaveLength(2);
      expect(tickets[0].state_detail?.name).toBe('Done');
      expect(tickets[1].state_detail?.name).toBe('In Progress');
    });

    it('respeta el limite de per_page (max 100)', async () => {
      const { service, http } = makePlaneService();

      http.get.mockResolvedValue({ data: { results: [] } });

      await service.listProjectTickets('proj-1', 150);
      const issuesCall = http.get.mock.calls.find((c) => c[0].includes('/issues/'));
      expect(issuesCall?.[1]?.params?.per_page).toBe(100);
    });

    it('tickets que ya tienen state_detail no son sobreescritos', async () => {
      const { service, http } = makePlaneService();

      http.get
        .mockResolvedValueOnce({
          data: {
            results: [
              {
                id: 'uuid-1',
                sequence_id: 1,
                name: 'Test',
                state_detail: { name: 'Bloqueado', group: 'cancelled' },
                created_at: '',
                updated_at: '',
              },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { results: [] } }); // states vacio

      const tickets = await service.listProjectTickets('proj-1');
      expect(tickets[0].state_detail?.name).toBe('Bloqueado');
    });
  });

  // ── createTicket — endpoint intake ──────────────────────────────────────

  describe('createTicket — intake endpoint', () => {
    it('usa /intake/issues/ y extrae issue del response', async () => {
      const { service, http } = makePlaneService();

      http.post.mockResolvedValueOnce({
        data: {
          id: 'intake-uuid',
          issue: {
            id: 'issue-uuid',
            sequence_id: 5,
            name: '[Intake Soporte] TestProject - descripcion del problema',
            created_at: '',
            updated_at: '',
          },
          status: -2,
          source: 'whatsapp',
        },
      });

      const result = await service.createTicket({
        name: '[Intake Soporte] TestProject - descripcion del problema',
        description: 'descripcion del problema',
        customerId: 'cust-1',
        projectName: 'TestProject',
        channel: 'WHATSAPP',
        isOverage: false,
        planeProjectId: 'proj-1',
      });

      const postCall = http.post.mock.calls[0];
      expect(postCall[0]).toContain('/intake/issues/');
      expect(postCall[1]).toMatchObject({
        issue: { name: expect.stringContaining('[Intake Soporte]') },
        source: 'whatsapp',
      });

      expect(result.id).toBe('issue-uuid');
      expect(result.sequence_id).toBe(5);
    });

    it('marca hora excedente en description_html', async () => {
      const { service, http } = makePlaneService();

      http.post.mockResolvedValueOnce({
        data: {
          id: 'intake-uuid',
          issue: { id: 'issue-uuid', sequence_id: 6, name: 'Test', created_at: '', updated_at: '' },
        },
      });

      await service.createTicket({
        name: '[Intake Soporte] Test - problema',
        description: 'problema grave',
        customerId: 'cust-1',
        projectName: 'Test',
        channel: 'WHATSAPP',
        isOverage: true,
        planeProjectId: 'proj-1',
      });

      const body = http.post.mock.calls[0][1];
      expect(body.issue.description_html).toContain('HORA EXCEDENTE');
    });

    it('lanza error si no hay planeProjectId ni fallback', async () => {
      const config = {
        getOrThrow: (key: string) => {
          const vals: Record<string, string> = { PLANE_API_KEY: 'k', PLANE_WORKSPACE_SLUG: 'ws' };
          return vals[key];
        },
        get: (key: string, def?: string) => {
          if (key === 'PLANE_PROJECT_ID') return ''; // sin fallback
          return def;
        },
      } as unknown as ConfigService;

      mockedAxios.create = jest.fn().mockReturnValue(makeMockHttp());
      const service = new PlaneService(config);

      await expect(
        service.createTicket({
          name: 'Test',
          description: 'desc',
          customerId: 'c',
          projectName: 'p',
          channel: 'EMAIL',
          isOverage: false,
        }),
      ).rejects.toThrow('No se definió un proyecto destino');
    });
  });
});
