import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    workers: { retention: false },
    retention: {
      auditMonths: 12,
      dgaMonths: 36,
      inactivityMonths: 24,
      noticeDays: 30,
    },
  },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
}));

vi.mock('../../../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mocks de auditLog para supresion.ts que se invoca indirectamente
vi.mock('../../../services/auditLog.js', () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

import {
  anonimizarAuditLogAntiguo,
  enviarAvisosInactividad,
  anonimizarCuentasInactivas,
} from '../worker';

// Helpers
function makeDbQuery(defaultRows: unknown[] = []) {
  return vi.fn().mockResolvedValue({ rows: defaultRows });
}

const mockSendAviso = vi.fn().mockResolvedValue(undefined);

describe('retentionWorker — anonimizarAuditLogAntiguo()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Llama UPDATE con WHERE ts < NOW() - interval para entradas > 12 meses no-DGA', async () => {
    const dbQ = makeDbQuery([]);

    await anonimizarAuditLogAntiguo(dbQ);

    // Primera llamada: UPDATE para entradas no-DGA
    const [sql] = dbQ.mock.calls[0] as [string];
    expect(sql).toContain('UPDATE audit_log');
    expect(sql).toContain('12');
    expect(sql).toContain('month');
    expect(sql).toContain("NOT LIKE 'dga.%'");
  });

  it("2. Usa 36 meses para acciones DGA (action LIKE 'dga.%')", async () => {
    const dbQ = makeDbQuery([]);

    await anonimizarAuditLogAntiguo(dbQ);

    // Segunda llamada: UPDATE para entradas DGA
    const [sql] = dbQ.mock.calls[1] as [string];
    expect(sql).toContain('UPDATE audit_log');
    expect(sql).toContain('36');
    expect(sql).toContain('month');
    expect(sql).toContain("LIKE 'dga.%'");
  });
});

describe('retentionWorker — enviarAvisosInactividad()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendAviso.mockResolvedValue(undefined);
  });

  it('3. Busca usuarios con last_login_at < NOW() - 23 meses AND aviso_inactividad_enviado_at IS NULL', async () => {
    const dbQ = makeDbQuery([]);

    await enviarAvisosInactividad(dbQ, mockSendAviso);

    const [sql] = dbQ.mock.calls[0] as [string];
    expect(sql).toContain('SELECT');
    expect(sql).toContain('aviso_inactividad_enviado_at IS NULL');
    expect(sql).toContain('23');
    expect(sql).toContain('month');
  });

  it('4. Llama sendAvisoInactividad con datos del usuario', async () => {
    const fakeUsers = [
      { id: 'U001', email: 'jose@empresa.cl', nombre: 'José' },
      { id: 'U002', email: 'maria@empresa.cl', nombre: 'María' },
    ];
    const dbQ = vi.fn()
      .mockResolvedValueOnce({ rows: fakeUsers })     // SELECT usuarios
      .mockResolvedValue({ rows: [] });                // UPDATE avisos

    await enviarAvisosInactividad(dbQ, mockSendAviso);

    expect(mockSendAviso).toHaveBeenCalledTimes(2);
    expect(mockSendAviso).toHaveBeenCalledWith('jose@empresa.cl', 'José', expect.any(Number));
    expect(mockSendAviso).toHaveBeenCalledWith('maria@empresa.cl', 'María', expect.any(Number));
  });

  it('5. Marca aviso_inactividad_enviado_at = NOW() tras enviar', async () => {
    const fakeUsers = [{ id: 'U001', email: 'jose@empresa.cl', nombre: 'José' }];
    const dbQ = vi.fn()
      .mockResolvedValueOnce({ rows: fakeUsers })
      .mockResolvedValue({ rows: [] });

    await enviarAvisosInactividad(dbQ, mockSendAviso);

    const updateCall = dbQ.mock.calls.find(([sql]: [string]) =>
      sql.includes('UPDATE usuario') && sql.includes('aviso_inactividad_enviado_at'),
    );
    expect(updateCall).toBeDefined();
    const [, params] = updateCall! as [string, unknown[]];
    expect(params[0]).toBe('U001');
  });
});

describe('retentionWorker — anonimizarCuentasInactivas()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('6. Busca usuarios con last_login_at < NOW() - 24 meses AND aviso_inactividad_enviado_at < NOW() - 30 días', async () => {
    const dbQ = makeDbQuery([]);

    await anonimizarCuentasInactivas(dbQ);

    const [sql] = dbQ.mock.calls[0] as [string];
    expect(sql).toContain('SELECT');
    expect(sql).toContain('aviso_inactividad_enviado_at');
    expect(sql).toContain('24');
    expect(sql).toContain('30');
  });

  it('7. Llama suprimirUsuario para cada cuenta inactiva encontrada', async () => {
    const fakeUsers = [
      { id: 'U001', email: 'jose@empresa.cl', nombre: 'José', apellido: 'G', tipo: 'Cliente' },
      { id: 'U002', email: 'pedro@empresa.cl', nombre: 'Pedro', apellido: 'R', tipo: 'Cliente' },
    ];

    const dbQ = vi.fn().mockResolvedValueOnce({ rows: fakeUsers });
    const mockSuprimir = vi.fn().mockResolvedValue(undefined);

    await anonimizarCuentasInactivas(dbQ, mockSuprimir);

    // Debe llamarse una vez por cada usuario inactivo
    expect(mockSuprimir).toHaveBeenCalledTimes(2);
    expect(mockSuprimir).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'U001' }));
    expect(mockSuprimir).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'U002' }));
  });
});
