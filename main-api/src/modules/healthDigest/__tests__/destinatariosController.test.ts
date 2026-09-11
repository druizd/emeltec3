/**
 * Tests del PUT/GET de destinatarios del monitoreo (healthDigest).
 *
 * Foco en la validación del body: la lista se reemplaza completa, así que un
 * duplicado o un email basura no debe llegar a la BD (donde el email es PK y
 * el "último gana" borraría filas sin avisar).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import type * as RepoModule from '../destinatariosRepo';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    // La pantalla necesita el estado del worker de auditoría, que es el que
    // manda las alertas de seguridad — switch distinto al de healthDigest.
    workers: { auditAlerts: true },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/heartbeat', () => ({ beat: vi.fn() }));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendHealthDigest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/email-otp', () => ({
  require2fa: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../destinatariosRepo', async () => {
  const actual = await vi.importActual<typeof RepoModule>('../destinatariosRepo');
  return {
    normalizeEmail: actual.normalizeEmail,
    listDestinatarios: vi.fn(),
    listDestinatariosActivos: vi.fn(),
    replaceDestinatarios: vi.fn(),
  };
});

import { listDestinatarios, replaceDestinatarios } from '../destinatariosRepo';
import { require2fa } from '../../../shared/email-otp';
import {
  listDigestDestinatariosHandler,
  replaceDigestDestinatariosHandler,
  require2faIfNuevoDestinatario,
} from '../destinatariosController';
import { MONITOR_PRIMARY } from '../worker';

const mockList = listDestinatarios as Mock;
const mockReplace = replaceDestinatarios as Mock;
const mock2fa = require2fa as Mock;

interface Captured {
  body?: unknown;
}

function fakeRes(): { res: Response; captured: Captured } {
  const captured: Captured = {};
  const res = {
    json: (body: unknown) => {
      captured.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

function fakeReq(body: unknown, userId = 'U1'): Request {
  return { body, user: { id: userId, tipo: 'SuperAdmin' } } as unknown as Request;
}

function fila(over: Record<string, unknown> = {}) {
  return {
    email: 'persona@emeltec.cl',
    nombre: 'Persona',
    recibe_resumen: true,
    recibe_eventos: true,
    recibe_seguridad: true,
    umbral_evento: 't3',
    activo: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /health-digest/destinatarios', () => {
  it('devuelve la lista con la metadata del worker', async () => {
    mockList.mockResolvedValueOnce([{ ...fila(), updated_at: null }]);
    const { res, captured } = fakeRes();
    const next = vi.fn();

    await listDigestDestinatariosHandler(fakeReq(undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    const body = captured.body as { data: unknown[]; meta: Record<string, unknown> };
    expect(body.data).toHaveLength(1);
    expect(body.meta.horarios_resumen).toEqual([7, 16]);
    expect(body.meta.zona_horaria).toBe('America/Santiago');
    expect(body.meta.fallback_email).toBe(MONITOR_PRIMARY);
    // Los dos workers viajan por separado: healthDigest manda el resumen y las
    // escalaciones, auditAlerts las alertas de seguridad. Con uno apagado y el
    // otro encendido, un solo flag hacia la UI miente sobre la mitad de la tabla.
    expect(body.meta.worker_seguridad_activo).toBe(true);
  });
});

describe('PUT /health-digest/destinatarios — validación', () => {
  it('rechaza un email inválido sin tocar la BD', async () => {
    const { res } = fakeRes();
    const next = vi.fn();

    await replaceDigestDestinatariosHandler(
      fakeReq({ destinatarios: [fila({ email: 'no-es-un-email' })] }),
      res,
      next,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect((next.mock.calls[0]![0] as Error).message).toMatch(/inválido/i);
  });

  it('rechaza duplicados que solo difieren en mayúsculas', async () => {
    const { res } = fakeRes();
    const next = vi.fn();

    await replaceDigestDestinatariosHandler(
      fakeReq({
        destinatarios: [fila({ email: 'a@emeltec.cl' }), fila({ email: 'A@Emeltec.CL' })],
      }),
      res,
      next,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect((next.mock.calls[0]![0] as Error).message).toMatch(/duplicado/i);
  });

  it('rechaza más de 25 destinatarios', async () => {
    const { res } = fakeRes();
    const next = vi.fn();
    const muchos = Array.from({ length: 26 }, (_, i) => fila({ email: `p${i}@emeltec.cl` }));

    await replaceDigestDestinatariosHandler(fakeReq({ destinatarios: muchos }), res, next);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('normaliza el email y propaga el actor al repo', async () => {
    mockReplace.mockResolvedValueOnce([{ ...fila(), updated_at: null }]);
    const { res } = fakeRes();
    const next = vi.fn();

    await replaceDigestDestinatariosHandler(
      fakeReq({ destinatarios: [fila({ email: ' Persona@EMELTEC.cl ' })] }, 'U7'),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith(
      [
        {
          email: 'persona@emeltec.cl',
          nombre: 'Persona',
          recibe_resumen: true,
          recibe_eventos: true,
          recibe_seguridad: true,
          umbral_evento: 't3',
          activo: true,
        },
      ],
      'U7',
    );
  });

  it('avisa cuando nadie queda suscrito al resumen (se usará el respaldo)', async () => {
    mockReplace.mockResolvedValueOnce([
      { ...fila({ recibe_resumen: false }), updated_at: null },
      { ...fila({ email: 'pausado@emeltec.cl', activo: false }), updated_at: null },
    ]);
    const { res, captured } = fakeRes();

    await replaceDigestDestinatariosHandler(
      fakeReq({ destinatarios: [fila({ recibe_resumen: false })] }),
      res,
      vi.fn(),
    );

    const body = captured.body as { meta: { fallback_en_uso: boolean; fallback_email: string } };
    expect(body.meta.fallback_en_uso).toBe(true);
    expect(body.meta.fallback_email).toBe(MONITOR_PRIMARY);
  });

  it('lista vacía es válida: borra todo y avisa del respaldo', async () => {
    mockReplace.mockResolvedValueOnce([]);
    const { res, captured } = fakeRes();
    const next = vi.fn();

    await replaceDigestDestinatariosHandler(fakeReq({ destinatarios: [] }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith([], 'U1');
    const body = captured.body as { meta: { fallback_en_uso: boolean } };
    expect(body.meta.fallback_en_uso).toBe(true);
  });
});

describe('require2faIfNuevoDestinatario — 2FA solo al sumar direcciones', () => {
  it('exige 2FA cuando aparece un email que no estaba en la lista', async () => {
    mockList.mockResolvedValueOnce([{ ...fila({ email: 'viejo@emeltec.cl' }), updated_at: null }]);
    const { res } = fakeRes();
    const next = vi.fn();

    await require2faIfNuevoDestinatario(
      fakeReq({ destinatarios: [fila({ email: 'nuevo@emeltec.cl' })] }),
      res,
      next,
    );

    expect(mock2fa).toHaveBeenCalledOnce();
  });

  it('no exige 2FA al editar o quitar direcciones ya autorizadas', async () => {
    mockList.mockResolvedValueOnce([
      { ...fila({ email: 'a@emeltec.cl' }), updated_at: null },
      { ...fila({ email: 'b@emeltec.cl' }), updated_at: null },
    ]);
    const { res } = fakeRes();
    const next = vi.fn();

    // Queda solo 'a', con el resumen apagado: sin direcciones nuevas.
    await require2faIfNuevoDestinatario(
      fakeReq({ destinatarios: [fila({ email: 'A@Emeltec.cl', recibe_resumen: false })] }),
      res,
      next,
    );

    expect(mock2fa).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('lista vacía (borrar todo) no exige 2FA', async () => {
    const { res } = fakeRes();
    const next = vi.fn();

    await require2faIfNuevoDestinatario(fakeReq({ destinatarios: [] }), res, next);

    expect(mockList).not.toHaveBeenCalled();
    expect(mock2fa).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('si no puede leer la lista actual, exige 2FA (fail-closed)', async () => {
    mockList.mockRejectedValueOnce(new Error('db caída'));
    const { res } = fakeRes();
    const next = vi.fn();

    await require2faIfNuevoDestinatario(
      fakeReq({ destinatarios: [fila({ email: 'x@emeltec.cl' })] }),
      res,
      next,
    );

    expect(mock2fa).toHaveBeenCalledOnce();
  });
});
