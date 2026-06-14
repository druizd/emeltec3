import { describe, it, expect } from 'vitest';
// El módulo es CommonJS (.js) consumido por el controlador v1; vitest lo resuelve vía allowJs.
import {
  summarize,
  overallStatus,
  publicView,
  detailView,
  ingestionSummary,
  workerSnapshot,
  processVitals,
} from '../statusReport';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe('summarize', () => {
  it('cuenta servicios por estado', () => {
    const services = {
      api: { status: 'online' },
      auth: { status: 'online' },
      database: { status: 'degraded' },
      pipeline: { status: 'offline' },
    };
    expect(summarize(services)).toEqual({
      total: 4,
      online: 2,
      degraded: 1,
      offline: 1,
    });
  });

  it('devuelve ceros para un inventario vacío', () => {
    expect(summarize({})).toEqual({ total: 0, online: 0, degraded: 0, offline: 0 });
  });
});

describe('overallStatus', () => {
  it('es online cuando todos están online', () => {
    expect(overallStatus({ a: { status: 'online' }, b: { status: 'online' } })).toBe('online');
  });

  it('es degraded si hay al menos un degradado y ninguno caído', () => {
    expect(overallStatus({ a: { status: 'online' }, b: { status: 'degraded' } })).toBe('degraded');
  });

  it('es offline si hay al menos un servicio caído (precede a degraded)', () => {
    expect(
      overallStatus({
        a: { status: 'degraded' },
        b: { status: 'offline' },
        c: { status: 'online' },
      }),
    ).toBe('offline');
  });

  it('es degraded cuando no hay datos', () => {
    expect(overallStatus({})).toBe('degraded');
  });
});

describe('publicView', () => {
  it('expone solo el estado y descarta todo detalle interno', () => {
    expect(
      publicView({
        status: 'degraded',
        response_time_ms: 42,
        environment: 'production',
        error: 'connection refused to 10.0.0.5',
        http_status: 502,
      }),
    ).toEqual({ status: 'degraded' });
  });

  it('cae a offline si el estado es desconocido', () => {
    expect(publicView({})).toEqual({ status: 'offline' });
  });
});

describe('detailView', () => {
  it('mantiene los campos de detalle permitidos', () => {
    const view = detailView({
      status: 'online',
      response_time_ms: 12,
      uptime_s: 3600,
      environment: 'production',
      version: '1.2.3',
      node_version: 'v24.0.0',
    });
    expect(view).toEqual({
      status: 'online',
      response_time_ms: 12,
      uptime_s: 3600,
      environment: 'production',
      version: '1.2.3',
      node_version: 'v24.0.0',
    });
  });

  it('descarta campos no incluidos en la lista blanca (p. ej. hosts internos)', () => {
    const view = detailView({
      status: 'online',
      internal_host: '10.0.0.5:50051',
      stack: 'Error: ...',
    });
    expect(view).toEqual({ status: 'online' });
  });

  it('omite campos nulos o indefinidos', () => {
    expect(detailView({ status: 'online', response_time_ms: null, uptime_s: undefined })).toEqual({
      status: 'online',
    });
  });

  it('preserva un mensaje de error (visible solo para el endpoint autenticado)', () => {
    expect(detailView({ status: 'offline', error: 'timeout' })).toEqual({
      status: 'offline',
      error: 'timeout',
    });
  });
});

describe('ingestionSummary', () => {
  const fresh = 15 * MIN;

  it('online cuando todos transmiten dentro del umbral', () => {
    const rows = [
      { last_received_at: new Date(NOW - 2 * MIN).toISOString() },
      { last_received_at: new Date(NOW - 5 * MIN).toISOString() },
    ];
    expect(ingestionSummary(rows, NOW, fresh)).toEqual({
      status: 'online',
      sites_total: 2,
      transmitting: 2,
      stale: 0,
      last_age_s: 120,
    });
  });

  it('degraded cuando algunos están stale', () => {
    const rows = [
      { last_received_at: new Date(NOW - 2 * MIN).toISOString() },
      { last_received_at: new Date(NOW - 40 * MIN).toISOString() },
      { last_received_at: null },
    ];
    const r = ingestionSummary(rows, NOW, fresh);
    expect(r.status).toBe('degraded');
    expect(r.sites_total).toBe(3);
    expect(r.transmitting).toBe(1);
    expect(r.stale).toBe(2);
    expect(r.last_age_s).toBe(120);
  });

  it('offline cuando ninguno transmite', () => {
    const rows = [{ last_received_at: new Date(NOW - 60 * MIN).toISOString() }];
    expect(ingestionSummary(rows, NOW, fresh).status).toBe('offline');
  });

  it('un last_received_at nulo cuenta como stale', () => {
    expect(ingestionSummary([{ last_received_at: null }], NOW, fresh)).toMatchObject({
      transmitting: 0,
      stale: 1,
      last_age_s: null,
    });
  });

  it('unknown cuando no hay sitios activos', () => {
    expect(ingestionSummary([], NOW, fresh)).toEqual({
      status: 'unknown',
      sites_total: 0,
      transmitting: 0,
      stale: 0,
      last_age_s: null,
    });
  });
});

describe('workerSnapshot', () => {
  const names = ['alertas', 'dgaWorker', 'contadores'];
  const stale = 30 * MIN;

  it('clasifica online / degraded / unknown según el último latido', () => {
    const beats = { alertas: NOW - 10_000, dgaWorker: NOW - 60 * MIN };
    expect(workerSnapshot(beats, names, NOW, stale)).toEqual([
      { name: 'alertas', status: 'online', last_run_s: 10 },
      { name: 'dgaWorker', status: 'degraded', last_run_s: 3600 },
      { name: 'contadores', status: 'unknown', last_run_s: null },
    ]);
  });

  it('sin latidos, todos quedan unknown', () => {
    expect(
      workerSnapshot({}, names, NOW, stale).every(
        (w: { status: string }) => w.status === 'unknown',
      ),
    ).toBe(true);
  });
});

describe('processVitals', () => {
  it('convierte memoria a MB redondeados', () => {
    expect(processVitals({ heapUsed: 88 * 1048576, rss: 142 * 1048576 })).toEqual({
      heap_mb: 88,
      rss_mb: 142,
    });
  });

  it('tolera entrada vacía', () => {
    expect(processVitals(null)).toEqual({ heap_mb: null, rss_mb: null });
  });
});
