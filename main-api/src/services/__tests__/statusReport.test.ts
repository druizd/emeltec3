import { describe, it, expect } from 'vitest';
// El módulo es CommonJS (.js) consumido por el controlador v1; vitest lo resuelve vía allowJs.
import { summarize, overallStatus, publicView, detailView } from '../statusReport';

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
