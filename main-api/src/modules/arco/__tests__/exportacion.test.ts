import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportarDatos } from '../exportacion';

const mockPerfil = {
  id: 'USR01',
  nombre: 'José',
  apellido: 'González',
  email: 'jose@empresa.cl',
  tipo: 'Cliente',
  empresa_nombre: 'Empresa Test',
  politica_aceptada_at: null,
};

const mockAuditRows = [
  {
    id: 1,
    action: 'user.login',
    target_type: null,
    target_id: null,
    status_code: 200,
    ts: '2025-01-01T00:00:00Z',
    metadata: null,
  },
  {
    id: 2,
    action: 'user.update',
    target_type: 'usuario',
    target_id: 'USR01',
    status_code: 200,
    ts: '2025-01-02T00:00:00Z',
    metadata: null,
  },
];

const mockAuditRecord = vi.fn().mockResolvedValue(undefined);

const baseParams = {
  userId: 'USR01',
  req: {},
  auditRecord: mockAuditRecord,
};

describe('exportarDatos()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditRecord.mockResolvedValue(undefined);
  });

  it('1. Devuelve { perfil, audit, exportado_at } con los datos del usuario', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockPerfil] }) // SELECT perfil
      .mockResolvedValueOnce({ rows: mockAuditRows }); // SELECT audit_log

    const result = await exportarDatos({ ...baseParams, dbQuery });

    expect(result.perfil).toEqual(mockPerfil);
    expect(result.audit).toEqual(mockAuditRows);
    expect(result.exportado_at).toBeTruthy();
  });

  it('2. Llama auditRecord con action "user.export_datos"', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockPerfil] })
      .mockResolvedValueOnce({ rows: mockAuditRows });

    await exportarDatos({ ...baseParams, dbQuery });

    expect(mockAuditRecord).toHaveBeenCalledOnce();
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.export_datos', actorId: 'USR01' }),
    );
  });

  it('3. Si el usuario no existe → lanza error 404', async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(exportarDatos({ ...baseParams, dbQuery })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('4. Limita audit a max 500 entradas (verifica LIMIT 500 en SQL)', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockPerfil] })
      .mockResolvedValueOnce({ rows: [] });

    await exportarDatos({ ...baseParams, dbQuery });

    const auditCall = dbQuery.mock.calls[1]!;
    const sql: string = auditCall[0];
    expect(sql).toContain('LIMIT 500');
  });

  it('5. exportado_at es una ISO string válida', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockPerfil] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await exportarDatos({ ...baseParams, dbQuery });

    expect(() => new Date(result.exportado_at)).not.toThrow();
    expect(result.exportado_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('6. Consulta audit_log filtrando por actor_id del usuario', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockPerfil] })
      .mockResolvedValueOnce({ rows: [] });

    await exportarDatos({ ...baseParams, dbQuery });

    const auditCall = dbQuery.mock.calls[1]!;
    const sql: string = auditCall[0];
    const params: unknown[] = auditCall[1];
    expect(sql).toContain('actor_id');
    expect(params).toContain('USR01');
  });

  it('7. Devuelve array vacío de audit si no hay entradas', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [mockPerfil] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await exportarDatos({ ...baseParams, dbQuery });

    expect(result.audit).toEqual([]);
  });
});
