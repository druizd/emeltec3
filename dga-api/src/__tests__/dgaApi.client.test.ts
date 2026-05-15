import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../shared/env', () => ({
  config: {
    dga: { apiUrl: 'https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas' },
  },
}));

vi.mock('../shared/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { submitToDga } from '../infrastructure/dga-client/dgaApi.client';
import { ExternalServiceError } from '../shared/errors';
import type { DgaSubmissionPayload } from '../domain/submission/dgaEnvelope';

const payload: DgaSubmissionPayload = {
  informante: { rut: '20999888-7', clave: '9A4PUqd1t4', rutEmpresa: '77555666-7' },
  obraDga: 'OB-0101-114',
  report: {
    sitioId: 'S01',
    obra: 'OB-0101-114',
    timestamp: new Date('2023-09-07T14:00:00.000Z'),
    nivelFreatico: 9.85,
    caudal: 1.0,
    totalizado: 1010,
  },
};

function makeFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.stubGlobal('fetch', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('submitToDga', () => {
  it('status "00" → estatus enviado + extrae numeroComprobante', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(200, {
        status: '00',
        message: 'Medición subterránea ingresada correctamente',
        data: { numeroComprobante: 'zk7DOAl3uIlGTjvwNtwBF0sBLAR16cI5' },
      }),
    );

    const result = await submitToDga(payload);

    expect(result.estatus).toBe('enviado');
    expect(result.comprobante).toBe('zk7DOAl3uIlGTjvwNtwBF0sBLAR16cI5');
    expect(result.url).toBe('https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas');
  });

  it('status distinto de "00" → estatus rechazado', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(200, {
        status: '99',
        message: 'Error de validación',
        data: {},
      }),
    );

    const result = await submitToDga(payload);

    expect(result.estatus).toBe('rechazado');
    expect(result.comprobante).toBeUndefined();
  });

  it('respuesta sin comprobante → comprobante undefined', async () => {
    vi.stubGlobal('fetch', makeFetch(200, { status: '00', message: 'OK', data: {} }));

    const result = await submitToDga(payload);

    expect(result.estatus).toBe('enviado');
    expect(result.comprobante).toBeUndefined();
  });

  it('HTTP 4xx → lanza ExternalServiceError', async () => {
    vi.stubGlobal('fetch', makeFetch(401, { error: 'Unauthorized' }));

    await expect(submitToDga(payload)).rejects.toThrow(ExternalServiceError);
  });

  it('HTTP 500 → lanza ExternalServiceError', async () => {
    vi.stubGlobal('fetch', makeFetch(500, null));

    await expect(submitToDga(payload)).rejects.toThrow(ExternalServiceError);
  });

  it('envía codigoObra en header', async () => {
    const mockFetch = makeFetch(200, { status: '00', data: {} });
    vi.stubGlobal('fetch', mockFetch);

    await submitToDga(payload);

    const [, options] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((options.headers as Record<string, string>)['codigoObra']).toBe('OB-0101-114');
  });

  it('envía Content-Type application/json', async () => {
    const mockFetch = makeFetch(200, { status: '00', data: {} });
    vi.stubGlobal('fetch', mockFetch);

    await submitToDga(payload);

    const [, options] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
