/**
 * Condición `sobre_derecho_dga`: el caudal instantáneo (mapeo con rol caudal,
 * transformado igual que el dashboard) supera el derecho de aprovechamiento
 * cargado en pozo_config más la tolerancia. Sin derecho cargado no evalúa.
 *
 * Crudo real de S127: REG3003/REG3004 IEEE754 word_swap = 53,31 L/s.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    workers: { alerts: false },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  getClient: vi.fn(),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { evaluarAlerta } from '../worker';

const caudalMapping = {
  id: 'RM87702B71',
  sitio_id: 'S127',
  alias: 'REG3003',
  d1: 'REG3003',
  d2: 'REG3004',
  tipo_dato: 'FLOAT',
  unidad: 'L/s',
  rol_dashboard: 'caudal',
  transformacion: 'ieee754_32',
  parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
};

/** Mapeo roto que comparte rol (resto de un recambio): su registro ya no llega. */
const caudalRoto = {
  ...caudalMapping,
  id: 'RM976BEA22',
  alias: 'REG2002',
  d1: 'REG2002',
  d2: null,
  transformacion: 'lineal',
  parametros: { factor: 1, offset: 0 },
};

const crudoS127 = { AI24: 187, REG3001: 40035, REG3002: 18399, REG3003: 16609, REG3004: 16981 };

function makeAlerta(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alerta-derecho',
    nombre: 'Sobre el derecho',
    empresa_id: 'E113',
    sub_empresa_id: 'SE115',
    sitio_id: 'S127',
    creado_por: 'SA001',
    variable_key: 'caudal',
    condicion: 'sobre_derecho_dga',
    umbral_bajo: null,
    umbral_alto: null,
    severidad: 'alta',
    cooldown_minutos: 5,
    dias_activos: null,
    id_serial: '151.21.36.25',
    sitio_desc: 'Pozo 2',
    ...overrides,
  };
}

function makeClient({
  derecho,
  toleranciaPct = 20,
  mappings,
  data = crudoS127,
}: {
  derecho: number | null;
  toleranciaPct?: number;
  mappings: unknown[];
  data?: Record<string, unknown>;
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    _calls: calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM pozo_config/.test(sql)) {
        return {
          rows: [{ dga_caudal_max_lps: derecho, dga_caudal_tolerance_pct: toleranciaPct }],
        };
      }
      if (/FROM reg_map/.test(sql)) return { rows: mappings };
      if (/FROM equipo/.test(sql)) return { rows: [{ data }] };
      if (/INSERT INTO alertas_eventos/.test(sql)) return { rows: [{ id: 'evt-1' }] };
      return { rows: [] };
    }),
  };
  return client;
}

function eventoInsertado(client: ReturnType<typeof makeClient>) {
  return client._calls.find((c) => /INSERT INTO alertas_eventos/.test(c.sql));
}

describe('evaluarAlerta — sobre_derecho_dga', () => {
  it('dispara cuando el caudal transformado supera derecho × (1 + tolerancia)', async () => {
    // Derecho 40 L/s, tolerancia 20% → límite 48. Caudal 53,31 > 48.
    const client = makeClient({ derecho: 40, toleranciaPct: 20, mappings: [caudalMapping] });
    await evaluarAlerta(client, makeAlerta());

    const ins = eventoInsertado(client);
    expect(ins).toBeDefined();
    expect(Number(ins!.params[5])).toBeCloseTo(53.31, 2);
    const mensaje = String(ins!.params[7]);
    expect(mensaje).toMatch(/sobre el derecho DGA/);
    expect(mensaje).toMatch(/48 L\/s/);
    expect(ins!.params).toContain('alta');
  });

  it('no dispara si el caudal queda dentro del derecho con tolerancia', async () => {
    // Derecho 50, tolerancia 20% → límite 60 > 53,31.
    const client = makeClient({ derecho: 50, toleranciaPct: 20, mappings: [caudalMapping] });
    await evaluarAlerta(client, makeAlerta());
    expect(eventoInsertado(client)).toBeUndefined();
  });

  it('sin derecho cargado no evalúa ni toca equipo', async () => {
    const client = makeClient({ derecho: null, mappings: [caudalMapping] });
    await evaluarAlerta(client, makeAlerta());
    expect(eventoInsertado(client)).toBeUndefined();
    expect(client._calls.some((c) => /FROM equipo/.test(c.sql))).toBe(false);
  });

  it('con dos mapeos de rol caudal usa el que calcula, como el dashboard', async () => {
    // El roto (REG2002) ordena primero por alias; su registro no llega.
    const client = makeClient({ derecho: 40, mappings: [caudalRoto, caudalMapping] });
    await evaluarAlerta(client, makeAlerta());
    const ins = eventoInsertado(client);
    expect(ins).toBeDefined();
    expect(Number(ins!.params[5])).toBeCloseTo(53.31, 2);
  });

  it('sin mapeo con rol caudal no hay contra qué comparar', async () => {
    const client = makeClient({ derecho: 40, mappings: [] });
    await evaluarAlerta(client, makeAlerta());
    expect(eventoInsertado(client)).toBeUndefined();
  });
});
