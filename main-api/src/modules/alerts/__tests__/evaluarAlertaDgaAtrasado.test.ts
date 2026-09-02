/**
 * Tests unitarios para evaluarAlertaDgaAtrasado.
 *
 * La referencia del atraso es el ÚLTIMO SLOT CON COMPROBANTE SNIA
 * (`dato_dga.comprobante`), no `pozo_config.dga_last_run_at`: ese campo lo
 * marca el fill cada vez que calcula un slot, aunque el envío lleve días
 * fallando. S127 (Agrosuper) estuvo 3 días sin comprobante y figuraba al día.
 *
 * Estrategia: el evaluador recibe `client` como parámetro → stub directo con
 * una cola de respuestas. Módulos con side-effects al importar (dbHelpers,
 * logger, appConfig) se mockean con vi.mock hoisteado.
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
  variable_key: 'dga',
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
 * Cliente fake con una cola de respuestas: cada client.query() consume una.
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

function insertDe(client: ReturnType<typeof makeClient>) {
  return client._calls.find((c) => c.sql.includes('INSERT'));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('evaluarAlertaDgaAtrasado — consulta de referencia', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('la referencia sale de dato_dga.comprobante, no de dga_last_run_at ni de dga_user', async () => {
    const client = makeClient([{ rows: [] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);

    expect(client._calls).toHaveLength(1);
    const sql = client._calls[0]!.sql;
    expect(sql).toMatch(/pozo_config/i);
    expect(sql).toMatch(/dga_activo/i);
    expect(sql).toMatch(/dato_dga/);
    expect(sql).toMatch(/comprobante IS NOT NULL/);
    expect(sql).not.toMatch(/dga_last_run_at/);
    expect(sql).not.toMatch(/dga_user/i);
  });

  it('la consulta usa sitio_id como parámetro de filtro', async () => {
    const client = makeClient([{ rows: [] }]);
    await evaluarAlertaDgaAtrasado(client, { ...BASE_ALERTA, sitio_id: 'S99' });
    expect(client._calls[0]!.params).toContain('S99');
  });

  it('sin config DGA activa retorna sin insertar alertas_eventos', async () => {
    const client = makeClient([{ rows: [] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    expect(client._calls).toHaveLength(1);
    expect(insertDe(client)).toBeUndefined();
  });
});

describe('evaluarAlertaDgaAtrasado — lag desde el último comprobante y tiers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function configCon(ultimoComprobanteHaceHoras: number, periodicidad = 'dia') {
    const now = Date.now();
    return {
      periodicidad,
      ultimo_comprobante_ts: new Date(now - ultimoComprobanteHaceHoras * 3_600_000).toISOString(),
      fecha_inicio: '2026-01-01',
      hora_inicio: '00:00:00',
    };
  }

  it('comprobante hace 12h con periodicidad dia → dentro del periodo, no inserta', async () => {
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
    const client = makeClient([{ rows: [configCon(12)] }, { rows: [] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    expect(insertDe(client)).toBeUndefined();
  });

  it('comprobante hace 54h con periodicidad dia → lag 30h → severidad media', async () => {
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
    const client = makeClient([
      { rows: [configCon(54)] },
      { rows: [] },
      { rows: [{ id: 'evento-1' }] },
    ]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    const ins = insertDe(client);
    expect(ins).toBeDefined();
    expect(ins!.params).toContain('media');
    expect(String(ins!.params[6])).toMatch(/sin comprobante/i);
    expect(String(ins!.params[6])).toMatch(/Último comprobante SNIA/);
  });

  it('pozo horario con 3 días sin comprobante (caso S127) → severidad crítica', async () => {
    vi.setSystemTime(new Date('2026-09-02T13:00:00Z'));
    // Último comprobante: slot 30-08 10:00Z. Periodicidad hora → esperado 11:00Z.
    // Lag = 02-09 13:00 − 30-08 11:00 = 74h ≥ 72h → crítica.
    const config = {
      periodicidad: 'hora',
      ultimo_comprobante_ts: '2026-08-30T10:00:00Z',
      fecha_inicio: '2026-01-01',
      hora_inicio: '00:00:00',
    };
    const client = makeClient([{ rows: [config] }, { rows: [] }, { rows: [{ id: 'evento-2' }] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    const ins = insertDe(client);
    expect(ins).toBeDefined();
    expect(ins!.params).toContain('critica');
  });

  it('ya notificada esa severidad o mayor → no inserta de nuevo', async () => {
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
    const client = makeClient([{ rows: [configCon(54)] }, { rows: [{ severidad: 'alta' }] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    expect(insertDe(client)).toBeUndefined();
  });

  it('recupera: comprobante reciente tras un evento alto → inserta el evento de recuperación resuelto', async () => {
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
    const client = makeClient([
      { rows: [configCon(2, 'hora')] },
      { rows: [{ severidad: 'alta' }] },
      { rows: [] },
    ]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    const ins = insertDe(client);
    expect(ins).toBeDefined();
    expect(ins!.sql).toMatch(/'baja',TRUE,TRUE/);
    expect(String(ins!.params[5])).toMatch(/al día/);
  });

  it('sin ningún comprobante todavía: la referencia es fecha_inicio/hora_inicio (lag 2h → no inserta)', async () => {
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
    // fecha_inicio 2026-06-20 06:00 (UTC-4 = 10:00Z) + 24h = 21 10:00Z → lag 2h
    const config = {
      periodicidad: 'dia',
      ultimo_comprobante_ts: null,
      fecha_inicio: '2026-06-20',
      hora_inicio: '06:00:00',
    };
    const client = makeClient([{ rows: [config] }, { rows: [] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    expect(insertDe(client)).toBeUndefined();
  });

  it('sin ningún comprobante y lag ≥ 24h → inserta media y lo dice en el mensaje', async () => {
    vi.setSystemTime(new Date('2026-06-22T12:00:00Z'));
    const config = {
      periodicidad: 'dia',
      ultimo_comprobante_ts: null,
      fecha_inicio: '2026-06-20',
      hora_inicio: '06:00:00',
    };
    const client = makeClient([{ rows: [config] }, { rows: [] }, { rows: [{ id: 'evento-3' }] }]);
    await evaluarAlertaDgaAtrasado(client, BASE_ALERTA);
    const ins = insertDe(client);
    expect(ins).toBeDefined();
    expect(ins!.params).toContain('media');
    expect(String(ins!.params[6])).toMatch(/Nunca se ha recibido un comprobante/);
  });
});
