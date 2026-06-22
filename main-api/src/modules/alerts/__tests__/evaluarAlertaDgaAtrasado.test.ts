/**
 * Tests unitarios para evaluarAlertaDgaAtrasado (hotfix dga_user → pozo_config).
 *
 * Estrategia: el evaluador recibe `client` como parámetro → stub directo,
 * sin mocks pesados. Módulos con side-effects al importar (dbHelpers, logger,
 * appConfig) se mockean con vi.mock hoisteado.
 *
 * Spec: §Part 1 "DGA Lag Math Preserved", §"DGA Config Query Shape Equivalence".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { evaluarAlertaDgaAtrasado } from '../worker';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_ALERTA = {
  id: 'alerta-1',
  nombre: 'DGA Test',
  empresa_id: 'emp-1',
  sub_empresa_id: null,
  sitio_id: 'sitio-1',
  creado_por: 'user-1',
  variable_key: 'nivel_freatico',
  condicion: 'dga_atrasado' as const,
  umbral_bajo: 0,
  umbral_alto: 0,
  severidad: 'media',
  cooldown_minutos: 120,
  dias_activos: null,
  id_serial: '',
  sitio_desc: 'Pozo Norte',
};

/**
 * Crea un cliente fake con una cola de respuestas.
 * Cada llamada a client.query() consume una respuesta de la cola.
 * Registra todas las llamadas para inspección.
 */
function makeClient(responses: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let idx = 0;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const resp = responses[idx++];
      if (!resp) throw new Error(`No hay respuesta stub para llamada #${idx}: ${sql.slice(0, 80)}`);
      return resp;
    }),
    _calls: calls,
  };
  return client;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('evaluarAlertaDgaAtrasado — consulta SQL (hotfix dga_user → pozo_config)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('la consulta de config apunta a pozo_config, dga_activo, sitio_id — NO usa dga_user', async () => {
    // Simula "sin config activa" → función retorna sin insertar evento.
    const client = makeClient([{ rows: [] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    expect(client._calls).toHaveLength(1);
    const sql = client._calls[0]!.sql;
    expect(sql).toMatch(/pozo_config/i);
    expect(sql).toMatch(/dga_activo/i);
    expect(sql).not.toMatch(/dga_user/i);
    expect(sql).not.toMatch(/dga_user/); // case-sensitive double-check
  });

  it('la consulta usa sitio_id (no site_id) como parámetro de filtro', async () => {
    const client = makeClient([{ rows: [] }]);
    await evaluarAlertaDgaAtrasado(client, { ...BASE_ALERTA, sitio_id: 'S99' });

    const params = client._calls[0]!.params;
    expect(params).toContain('S99');
  });

  it('sin config activa retorna sin insertar alertas_eventos', async () => {
    const client = makeClient([{ rows: [] }]); // config query: sin filas
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    // Solo debe haber ocurrido la consulta de config, ningún INSERT.
    expect(client._calls).toHaveLength(1);
    expect(client._calls[0]!.sql).not.toMatch(/INSERT/i);
  });
});

describe('evaluarAlertaDgaAtrasado — lag math y tiers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lag 12h (< 24h umbral media) → no inserta alertas_eventos', async () => {
    // last_run_at hace 12h con periodicidad dia → lag efectivo = 0h (dentro del periodo)
    const now = new Date('2026-06-21T12:00:00Z').getTime();
    vi.setSystemTime(now);

    const lastRunAt = new Date(now - 12 * 3_600_000).toISOString(); // 12h atrás
    const configRow = {
      periodicidad: 'dia',
      last_run_at: lastRunAt,
      fecha_inicio: '2026-01-01',
      hora_inicio: '06:00:00',
    };
    const client = makeClient([
      { rows: [configRow] }, // config query
      { rows: [] }, // last severity query
    ]);

    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    // No debe haber INSERT (lag < 24h → tierSev = null y lastRank = 0)
    const hasSeverityInsert = client._calls.some((c) => c.sql.includes('INSERT'));
    expect(hasSeverityInsert).toBe(false);
  });

  it('lag 30h (>= 24h, < 48h) → inserta con severidad media', async () => {
    const now = new Date('2026-06-21T12:00:00Z').getTime();
    vi.setSystemTime(now);

    // periodicidad=dia → period=24h; last_run_at=54h atrás → lag=54h-24h=30h efectivo
    const lastRunAt = new Date(now - 54 * 3_600_000).toISOString();
    const configRow = {
      periodicidad: 'dia',
      last_run_at: lastRunAt,
      fecha_inicio: '2026-01-01',
      hora_inicio: '06:00:00',
    };
    const insertResult = { rows: [{ id: 'evento-1' }] };

    const client = makeClient([
      { rows: [configRow] }, // config query
      { rows: [] }, // last severity query (sin evento previo)
      insertResult, // INSERT alertas_eventos
    ]);

    // También se llama a query() global para notificarUsuarios — necesitamos mockear eso
    // La función notificarUsuarios usa el `query` global, no el client. Ya lo mockeamos arriba.
    // Pero para este test, solo validamos el INSERT via client.
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    const insertCall = client._calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    // El 8º parámetro es la severidad.
    expect(insertCall!.params).toContain('media');
  });

  it('lag 80h (>= 72h) → inserta con severidad critica', async () => {
    const now = new Date('2026-06-21T12:00:00Z').getTime();
    vi.setSystemTime(now);

    // periodicidad=dia → period=24h; last_run_at=104h atrás → lag=104-24=80h
    const lastRunAt = new Date(now - 104 * 3_600_000).toISOString();
    const configRow = {
      periodicidad: 'dia',
      last_run_at: lastRunAt,
      fecha_inicio: '2026-01-01',
      hora_inicio: '06:00:00',
    };
    const insertResult = { rows: [{ id: 'evento-2' }] };

    const client = makeClient([{ rows: [configRow] }, { rows: [] }, insertResult]);

    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    const insertCall = client._calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params).toContain('critica');
  });

  it('fallback fecha_inicio/hora_inicio cuando last_run_at es null', async () => {
    const now = new Date('2026-06-21T12:00:00Z').getTime();
    vi.setSystemTime(now);

    // fecha_inicio=2026-06-20, hora_inicio=06:00:00 (UTC-4 = 10:00 UTC)
    // expected_next = 2026-06-20T10:00:00Z + 24h = 2026-06-21T10:00:00Z
    // now = 2026-06-21T12:00:00Z → lag = 2h < 24h → no inserta
    const configRow = {
      periodicidad: 'dia',
      last_run_at: null,
      fecha_inicio: '2026-06-20',
      hora_inicio: '06:00:00',
    };
    const client = makeClient([{ rows: [configRow] }, { rows: [] }]);

    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    const hasSeverityInsert = client._calls.some((c) => c.sql.includes('INSERT'));
    expect(hasSeverityInsert).toBe(false);
  });

  it('fallback fecha_inicio/hora_inicio con lag >= 24h → inserta con severidad media', async () => {
    const now = new Date('2026-06-22T12:00:00Z').getTime();
    vi.setSystemTime(now);

    // expected_next = 2026-06-20T10:00:00Z + 24h = 2026-06-21T10:00:00Z
    // now = 2026-06-22T12:00:00Z → lag = 26h >= 24h → media
    const configRow = {
      periodicidad: 'dia',
      last_run_at: null,
      fecha_inicio: '2026-06-20',
      hora_inicio: '06:00:00',
    };
    const insertResult = { rows: [{ id: 'evento-3' }] };

    const client = makeClient([{ rows: [configRow] }, { rows: [] }, insertResult]);

    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    const insertCall = client._calls.find((c) => c.sql.includes('INSERT'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params).toContain('media');
  });
});
