/**
 * Tests unitarios para getDgaUsersForMonitoring (hotfix dga_user → pozo_config).
 *
 * Spec: §Part 1 "getDgaUsersForMonitoring scenarios", §"DGA Config Query Shape Equivalence".
 * ADR-2: SQL debe apuntar a pozo_config + sitio, no a dga_user.
 * ADR-3: DgaUserRaw.id_dgauser debe igualar sitio_id (alias de compatibilidad).
 */
import { describe, it, expect, vi, type Mock } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import { query } from '../../../config/dbHelpers';
import { getDgaUsersForMonitoring } from '../repo';

const mockQuery = query as Mock;

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Fila pozo_config-shaped que devuelve la query nueva. */
const POZO_CONFIG_ROW = {
  id_dgauser: 'sitio-abc',
  site_id: 'sitio-abc',
  descripcion: 'Pozo Norte',
  empresa_nombre: 'Empresa Test',
  periodicidad: 'dia' as const,
  last_run_at: '2026-06-21T10:00:00Z',
  fecha_inicio: '2026-01-01',
  hora_inicio: '06:00:00',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getDgaUsersForMonitoring — consulta SQL (hotfix dga_user → pozo_config)', () => {
  it('la SQL apunta a pozo_config, sitio, dga_activo — NO usa dga_user', async () => {
    let capturedSql = '';
    mockQuery.mockImplementationOnce(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });

    await getDgaUsersForMonitoring();

    expect(capturedSql).toMatch(/pozo_config/i);
    expect(capturedSql).toMatch(/dga_activo/i);
    expect(capturedSql).toMatch(/sitio/i);
    expect(capturedSql).not.toMatch(/dga_user/i);
    expect(capturedSql).not.toMatch(/dga_user/); // case-sensitive
  });

  it('retorna una fila con shape DgaUserRaw correcta', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [POZO_CONFIG_ROW] });

    const result = await getDgaUsersForMonitoring();

    expect(result).toHaveLength(1);
    const row = result[0]!;
    expect(row.id_dgauser).toBe('sitio-abc');
    expect(row.site_id).toBe('sitio-abc');
    expect(row.descripcion).toBe('Pozo Norte');
    expect(row.empresa_nombre).toBe('Empresa Test');
    expect(row.periodicidad).toBe('dia');
  });
});

describe('getDgaUsersForMonitoring — alias id_dgauser = sitio_id (ADR-3)', () => {
  it('id_dgauser iguala site_id (alias de compatibilidad, no PK numérico)', async () => {
    const row = { ...POZO_CONFIG_ROW, id_dgauser: 'sitio-xyz', site_id: 'sitio-xyz' };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await getDgaUsersForMonitoring();

    expect(result[0]!.id_dgauser).toBe(result[0]!.site_id);
    expect(result[0]!.id_dgauser).toBe('sitio-xyz');
  });

  it('id_dgauser nunca es un número (el tipo es string)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [POZO_CONFIG_ROW] });

    const result = await getDgaUsersForMonitoring();

    expect(typeof result[0]!.id_dgauser).toBe('string');
  });
});

describe('getDgaUsersForMonitoring — filtros activo y tipo_sitio', () => {
  it('devuelve lista vacía cuando no hay pozos activos con DGA', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getDgaUsersForMonitoring();

    expect(result).toEqual([]);
  });

  it('la SQL excluye maletas (tipo_sitio <> maleta)', async () => {
    let capturedSql = '';
    mockQuery.mockImplementationOnce(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });

    await getDgaUsersForMonitoring();

    // El filtro de maletas debe estar presente en la query.
    expect(capturedSql).toMatch(/maleta/i);
  });

  it('la SQL requiere sitio.activo = TRUE', async () => {
    let capturedSql = '';
    mockQuery.mockImplementationOnce(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });

    await getDgaUsersForMonitoring();

    expect(capturedSql).toMatch(/s\.activo\s*=\s*TRUE/i);
  });
});
