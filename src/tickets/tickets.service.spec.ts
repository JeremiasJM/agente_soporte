import { TicketsService } from './tickets.service';
import { PlaneService } from '../integrations/plane/plane.service';

const mockPlane = {
  createTicket: jest.fn(),
  getTicket: jest.fn(),
  listProjectTickets: jest.fn(),
} as unknown as PlaneService;

describe('TicketsService', () => {
  let service: TicketsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TicketsService(mockPlane);
  });

  // ── normalizeStatus ──────────────────────────────────────────────────────

  describe('normalizeStatus', () => {
    const cases: Array<[string | undefined, string]> = [
      ['Done', 'cerrado'],
      ['Closed', 'cerrado'],
      ['Resuelto', 'cerrado'],
      ['Cerrado', 'cerrado'],
      ['Blocked', 'bloqueado'],
      ['Bloqueado', 'bloqueado'],
      ['On Hold', 'bloqueado'],
      ['In Progress', 'en_proceso'],
      ['In Review', 'en_proceso'],
      ['En Curso', 'en_proceso'],
      ['En Proceso', 'en_proceso'],
      ['Todo', 'abierto'],
      ['Backlog', 'abierto'],
      [undefined, 'abierto'],
      ['', 'abierto'],
    ];

    test.each(cases)('"%s" → "%s"', async (rawStatus, expected) => {
      (mockPlane.getTicket as jest.Mock).mockResolvedValueOnce({
        id: 'uuid-1',
        sequence_id: 1,
        name: 'Test ticket',
        state_detail: rawStatus !== undefined ? { name: rawStatus, group: 'started' } : undefined,
        created_at: '',
        updated_at: '',
      });

      const result = await service.getTicketStatus('uuid-1', 'proj-1');
      expect(result.found).toBe(true);
      expect(result.status).toBe(expected);
    });
  });

  // ── getTicketStatus ──────────────────────────────────────────────────────

  describe('getTicketStatus', () => {
    it('devuelve found=true con estado normalizado', async () => {
      (mockPlane.getTicket as jest.Mock).mockResolvedValueOnce({
        id: 'uuid-abc',
        sequence_id: 3,
        name: 'Pantalla en blanco',
        state_detail: { name: 'In Progress', group: 'started' },
        created_at: '',
        updated_at: '',
      });

      const result = await service.getTicketStatus('3', 'proj-1');
      expect(result).toEqual({
        found: true,
        status: 'en_proceso',
        description: 'Pantalla en blanco',
        planeTicketId: 'uuid-abc',
        sequenceId: 3,
      });
    });

    it('devuelve found=false cuando Plane lanza error', async () => {
      (mockPlane.getTicket as jest.Mock).mockRejectedValueOnce(new Error('Ticket #99 no encontrado'));

      const result = await service.getTicketStatus('99', 'proj-1');
      expect(result).toEqual({ found: false });
    });
  });

  // ── listTicketStatuses ───────────────────────────────────────────────────

  describe('listTicketStatuses', () => {
    it('devuelve todos los tickets con estados normalizados', async () => {
      (mockPlane.listProjectTickets as jest.Mock).mockResolvedValueOnce([
        {
          id: 'uuid-1',
          sequence_id: 1,
          name: 'Error de login',
          state_detail: { name: 'Done', group: 'completed' },
          created_at: '',
          updated_at: '',
        },
        {
          id: 'uuid-2',
          sequence_id: 2,
          name: 'Pantalla en blanco',
          state_detail: { name: 'In Progress', group: 'started' },
          created_at: '',
          updated_at: '',
        },
        {
          id: 'uuid-3',
          sequence_id: 3,
          name: 'Solicitud de cambio',
          state_detail: { name: 'Todo', group: 'unstarted' },
          created_at: '',
          updated_at: '',
        },
      ]);

      const result = await service.listTicketStatuses('proj-1', 20);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ sequenceId: 1, status: 'cerrado', description: 'Error de login' });
      expect(result[1]).toMatchObject({ sequenceId: 2, status: 'en_proceso', description: 'Pantalla en blanco' });
      expect(result[2]).toMatchObject({ sequenceId: 3, status: 'abierto', description: 'Solicitud de cambio' });
    });

    it('pasa limit a listProjectTickets', async () => {
      (mockPlane.listProjectTickets as jest.Mock).mockResolvedValueOnce([]);
      await service.listTicketStatuses('proj-1', 5);
      expect(mockPlane.listProjectTickets).toHaveBeenCalledWith('proj-1', 5);
    });

    it('devuelve array vacio cuando no hay tickets', async () => {
      (mockPlane.listProjectTickets as jest.Mock).mockResolvedValueOnce([]);
      const result = await service.listTicketStatuses('proj-1');
      expect(result).toEqual([]);
    });
  });
});
