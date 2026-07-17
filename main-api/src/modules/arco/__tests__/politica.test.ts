import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aceptarPolitica } from '../politica';

const mockPerfil = {
  id: 'USR01',
  nombre: 'José',
  apellido: 'González',
  email: 'jose@empresa.cl',
  tipo: 'Cliente',
  politica_aceptada_at: null,
};

const mockPerfilAceptado = {
  ...mockPerfil,
  politica_aceptada_at: '2025-07-16T12:00:00Z',
};

const mockAuditRecord = vi.fn().mockResolvedValue(undefined);

const baseParams = {
  userId: 'USR01',
  req: {},
  auditRecord: mockAuditRecord,
};

describe('aceptarPolitica()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditRecord.mockResolvedValue(undefined);
  });

  it('1. Si politica_aceptada_at es NULL → hace UPDATE y devuelve perfil actualizado', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // UPDATE (0 o 1 filas afectadas)
      .mockResolvedValueOnce({ rows: [mockPerfilAceptado] }); // SELECT perfil

    const result = await aceptarPolitica({ ...baseParams, dbQuery });

    expect(result.perfil).toEqual(mockPerfilAceptado);

    // El UPDATE debe incluir la condición idempotente
    const updateCall = dbQuery.mock.calls[0]!;
    const sql: string = updateCall[0];
    expect(sql).toContain('politica_aceptada_at IS NULL');
    expect(updateCall[1]).toContain('USR01');
  });

  it('2. Si ya tiene fecha → no sobreescribe (idempotente), igual devuelve perfil', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // UPDATE afecta 0 filas (ya tenía fecha)
      .mockResolvedValueOnce({ rows: [mockPerfilAceptado] }); // SELECT perfil devuelve la fecha previa

    const result = await aceptarPolitica({ ...baseParams, dbQuery });

    // Se sigue devolviendo el perfil aunque UPDATE no haya tocado nada
    expect((result.perfil as typeof mockPerfilAceptado).politica_aceptada_at).toBeTruthy();
    // El UPDATE sigue corriendo (es el WHERE el que lo hace idempotente)
    expect(dbQuery).toHaveBeenCalledTimes(2);
  });

  it('3. Usuario no encontrado → lanza error 404', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // SELECT vacío → no existe

    await expect(aceptarPolitica({ ...baseParams, dbQuery })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('4. Registra en audit_log la aceptación', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [mockPerfilAceptado] });

    await aceptarPolitica({ ...baseParams, dbQuery });

    expect(mockAuditRecord).toHaveBeenCalledOnce();
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.aceptar_politica', actorId: 'USR01' }),
    );
  });

  it('5. El UPDATE usa WHERE id = $1 AND politica_aceptada_at IS NULL', async () => {
    const dbQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [mockPerfilAceptado] });

    await aceptarPolitica({ ...baseParams, dbQuery });

    const sql: string = dbQuery.mock.calls[0]![0];
    expect(sql).toContain('UPDATE usuario');
    expect(sql).toContain('politica_aceptada_at = NOW()');
    expect(sql).toContain('AND politica_aceptada_at IS NULL');
  });
});
