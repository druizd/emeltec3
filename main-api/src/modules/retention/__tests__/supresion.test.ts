import { describe, it, expect, vi, beforeEach } from 'vitest';
import { suprimirUsuario } from '../supresion';

function makeDbQuery(rows: unknown[] = []) {
  return vi.fn().mockResolvedValue({ rows });
}

const mockAuditRecord = vi.fn().mockResolvedValue(undefined);

const baseParams = {
  actorId: 'SA001',
  actorEmail: 'admin@emeltec.cl',
  actorTipo: 'SuperAdmin',
  targetId: 'USR01',
  req: {},
  auditRecord: mockAuditRecord,
};

describe('suprimirUsuario()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditRecord.mockResolvedValue(undefined);
  });

  it('1. SuperAdmin puede suprimir a cualquier usuario', async () => {
    const targetRow = {
      id: 'USR01',
      email: 'jose@empresa.cl',
      nombre: 'José',
      apellido: 'González',
      tipo: 'Cliente',
    };
    const dbQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [targetRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await suprimirUsuario({ ...baseParams, dbQuery });

    expect(dbQuery).toHaveBeenCalledTimes(3);
  });

  it('2. Titular puede suprimirse a sí mismo', async () => {
    const targetRow = { id: 'USR01', email: 'jose@empresa.cl', nombre: 'José', apellido: 'G', tipo: 'Cliente' };
    const dbQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [targetRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    // actorId === targetId → titular
    await suprimirUsuario({
      ...baseParams,
      actorId: 'USR01',
      actorEmail: 'jose@empresa.cl',
      actorTipo: 'Cliente',
      targetId: 'USR01',
      dbQuery,
    });

    expect(dbQuery).toHaveBeenCalledTimes(3);
  });

  it('3. Admin NO puede suprimir a otro usuario — lanza error 403', async () => {
    const dbQuery = makeDbQuery([]);

    await expect(
      suprimirUsuario({
        ...baseParams,
        actorId: 'ADM01',
        actorEmail: 'admin@empresa.cl',
        actorTipo: 'Admin',
        targetId: 'USR01',
        dbQuery,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('4. SuperAdmin no puede suprimirse a sí mismo (self-supresión del actuante)', async () => {
    const dbQuery = makeDbQuery([]);

    await expect(
      suprimirUsuario({
        ...baseParams,
        actorId: 'SA001',
        actorEmail: 'admin@emeltec.cl',
        actorTipo: 'SuperAdmin',
        targetId: 'SA001', // mismo actor
        dbQuery,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('5. Usuario target no existe → lanza error 404', async () => {
    const dbQuery = vi.fn().mockResolvedValueOnce({ rows: [] }); // SELECT vacío

    await expect(
      suprimirUsuario({ ...baseParams, dbQuery }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('6. Anonimiza los campos correctos (email, nombre, apellido, rut_usuario, telefono)', async () => {
    const targetRow = { id: 'USR01', email: 'jose@empresa.cl', nombre: 'José', apellido: 'González', tipo: 'Cliente' };
    const dbQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [targetRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await suprimirUsuario({ ...baseParams, dbQuery });

    // Segunda llamada es el UPDATE de anonimización del usuario
    const updateCall = dbQuery.mock.calls[1];
    const sql: string = updateCall[0];
    expect(sql).toContain('UPDATE usuario');
    expect(sql).toContain('nombre');
    expect(sql).toContain('apellido');
    expect(sql).toContain('rut_usuario');
    expect(sql).toContain('telefono');
    expect(sql).toContain('email');
    expect(sql).toContain('activo');
  });

  it('7. Email queda como anonimizado+{user_id}@eliminado.invalid', async () => {
    const targetRow = { id: 'USR01', email: 'jose@empresa.cl', nombre: 'José', apellido: 'G', tipo: 'Cliente' };
    const dbQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [targetRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await suprimirUsuario({ ...baseParams, dbQuery });

    const updateCall = dbQuery.mock.calls[1];
    const params: unknown[] = updateCall[1];
    expect(params).toContain('anonimizado+USR01@eliminado.invalid');
  });

  it('8. Cuenta queda con activo=false', async () => {
    const targetRow = { id: 'USR01', email: 'jose@empresa.cl', nombre: 'José', apellido: 'G', tipo: 'Cliente' };
    const dbQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [targetRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await suprimirUsuario({ ...baseParams, dbQuery });

    const updateCall = dbQuery.mock.calls[1];
    const params: unknown[] = updateCall[1];
    expect(params).toContain(false);
  });

  it('9. Se registra en audit_log ANTES de anonimizar', async () => {
    const targetRow = { id: 'USR01', email: 'jose@empresa.cl', nombre: 'José', apellido: 'G', tipo: 'Cliente' };
    const callOrder: string[] = [];

    const dbQuery = vi.fn().mockImplementation(async (sql: string) => {
      if ((sql as string).includes('SELECT')) callOrder.push('select');
      else if ((sql as string).includes('UPDATE usuario')) callOrder.push('update-usuario');
      else if ((sql as string).includes('UPDATE audit_log')) callOrder.push('update-auditlog');
      return { rows: (sql as string).includes('SELECT') ? [targetRow] : [] };
    });

    const auditRecord = vi.fn().mockImplementation(async () => {
      callOrder.push('audit-record');
    });

    await suprimirUsuario({ ...baseParams, dbQuery, auditRecord });

    const auditIdx = callOrder.indexOf('audit-record');
    const updateIdx = callOrder.indexOf('update-usuario');
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(auditIdx); // audit ANTES de UPDATE
  });

  it('10. Se anonimiza actor_email e ip en audit_log del usuario suprimido', async () => {
    const targetRow = { id: 'USR01', email: 'jose@empresa.cl', nombre: 'José', apellido: 'G', tipo: 'Cliente' };
    const dbQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [targetRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await suprimirUsuario({ ...baseParams, dbQuery });

    // Tercera llamada es el UPDATE de audit_log
    const auditUpdateCall = dbQuery.mock.calls[2];
    const sql: string = auditUpdateCall[0];
    expect(sql).toContain('UPDATE audit_log');
    expect(sql).toContain('actor_email');
    expect(sql).toContain('ip');
    const params: unknown[] = auditUpdateCall[1];
    expect(params).toContain('[ANONIMIZADO]');
  });
});
