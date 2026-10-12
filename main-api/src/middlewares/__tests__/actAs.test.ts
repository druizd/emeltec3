/**
 * Token "ver como" (act_as) en los DOS `protect`: v2 (middlewares/auth.ts) y
 * legacy (middlewares/authMiddleware.js).
 *
 * Cubre: solo lectura, alcance del rol elegido, revocación contra el
 * SuperAdmin real y el suplantador en audit_log.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

// appConfig valida el entorno con zod al importarse.
vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

const SECRET = process.env.JWT_SECRET as string;

const revocacionV2 = vi.hoisted(() => vi.fn(async (_d: unknown) => false));
vi.mock('../../services/sessionRevocation', () => ({ isSessionRevoked: revocacionV2 }));

import { protect as protectV2, authorizeRoles } from '../auth';
import { READ_ONLY_ERROR, VIEW_AS_USER_ID } from '../../services/actAs';

/* eslint-disable @typescript-eslint/no-require-imports */
const protectLegacy = (require('../authMiddleware.js') as { protect: Handler }).protect;
// Misma instancia (require nativo) que usa el middleware legacy.
const sessionRevocation = require('../../services/sessionRevocation.js') as {
  _setPool: (p: unknown) => void;
  _resetCache: () => void;
};
const audit = require('../../services/auditLog.js') as {
  record: (e: Record<string, unknown>) => Promise<void>;
  auditMutations: (r: (req: unknown) => Record<string, unknown>) => Handler;
};
const pool = require('../../config/db.js') as { query: (...a: unknown[]) => Promise<unknown> };
/* eslint-enable @typescript-eslint/no-require-imports */

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

interface Resultado {
  status: number | undefined;
  body: { ok?: boolean; error?: unknown; message?: string } | undefined;
  nextCalled: boolean;
  nextError: { status?: number; message?: string } | undefined;
  req: Record<string, unknown>;
}

async function ejecutar(mw: Handler, method: string, token?: string): Promise<Resultado> {
  const req: Record<string, unknown> = {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const out: Resultado = {
    status: undefined,
    body: undefined,
    nextCalled: false,
    nextError: undefined,
    req,
  };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(b: Resultado['body']) {
      out.body = b;
      return this;
    },
  };
  await new Promise<void>((resolve) => {
    const next: NextFunction = (err?: unknown) => {
      out.nextCalled = true;
      out.nextError = err as Resultado['nextError'];
      resolve();
    };
    // El legacy es async y responde por `res`; el v2 llama next (con o sin error).
    void Promise.resolve(mw(req as unknown as Request, res as unknown as Response, next)).then(
      () => {
        if (out.status !== undefined) resolve();
      },
    );
  });
  return out;
}

/** Status efectivo: el legacy responde por res, el v2 por next(AppError). */
const statusDe = (r: Resultado): number | undefined => r.status ?? r.nextError?.status;
const mensajeDe = (r: Resultado): string | undefined =>
  (typeof r.body?.error === 'string' ? r.body.error : undefined) ?? r.nextError?.message;

function tokenActAs(over: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      id: VIEW_AS_USER_ID,
      email: 'root@emeltec.cl',
      tipo: 'Cliente',
      empresa_id: 'E1',
      sub_empresa_id: 'S1',
      act_as: true,
      real_sub: 'SA001',
      ...over,
    },
    SECRET,
    { expiresIn: 1800 },
  );
}

const tokenNormal = (tipo = 'Admin'): string =>
  jwt.sign({ id: 'U1', email: 'a@b.cl', tipo, empresa_id: 'E1', sub_empresa_id: null }, SECRET, {
    expiresIn: 3600,
  });

const poolRevocacion = { query: vi.fn() };

beforeEach(() => {
  revocacionV2.mockReset();
  revocacionV2.mockResolvedValue(false);
  poolRevocacion.query.mockReset();
  poolRevocacion.query.mockResolvedValue({ rows: [{ sessions_valid_from: null }] });
  sessionRevocation._resetCache();
  sessionRevocation._setPool(poolRevocacion);
});

describe.each([
  ['v2 (auth.ts)', protectV2 as Handler],
  ['legacy (authMiddleware.js)', protectLegacy],
])('protect %s con token "ver como"', (_nombre, protect) => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s responde 403 de solo lectura', async (method) => {
    const r = await ejecutar(protect, method, tokenActAs());
    expect(statusDe(r)).toBe(403);
    expect(mensajeDe(r)).toBe(READ_ONLY_ERROR);
    // La identidad queda en req para que auditMutations registre al suplantador.
    expect(r.req.user).toMatchObject({ id: VIEW_AS_USER_ID, tipo: 'Cliente' });
    expect(r.req.actAs).toEqual({ realUserId: 'SA001' });
    if (r.status !== undefined) expect(r.body).toEqual({ ok: false, error: READ_ONLY_ERROR });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s pasa con el alcance del rol elegido', async (method) => {
    const r = await ejecutar(protect, method, tokenActAs());
    expect(r.nextCalled).toBe(true);
    expect(r.nextError).toBeUndefined();
    expect(r.req.user).toMatchObject({
      id: VIEW_AS_USER_ID,
      tipo: 'Cliente',
      empresa_id: 'E1',
      sub_empresa_id: 'S1',
    });
    expect(r.req.actAs).toEqual({ realUserId: 'SA001' });
  });

  it('evalúa la revocación contra el SuperAdmin real, no contra el id simulado', async () => {
    await ejecutar(protect, 'GET', tokenActAs());
    if (protect === protectV2) {
      const arg = revocacionV2.mock.calls[0]?.[0] as { id: string; iat: number };
      expect(arg.id).toBe('SA001');
      expect(Number.isFinite(arg.iat)).toBe(true);
    } else {
      expect(poolRevocacion.query).toHaveBeenCalledTimes(1);
      expect(poolRevocacion.query.mock.calls[0]?.[1]).toEqual(['SA001']);
    }
  });

  it('corta el token "ver como" si el SuperAdmin real cambió su contraseña', async () => {
    revocacionV2.mockResolvedValue(true);
    poolRevocacion.query.mockResolvedValue({
      rows: [{ sessions_valid_from: new Date(Date.now() + 60_000) }],
    });
    const r = await ejecutar(protect, 'GET', tokenActAs());
    expect(statusDe(r)).toBe(401);
    expect(r.req.user).toBeUndefined();
  });

  it('rechaza un token act_as sin real_sub o con un rol no simulable', async () => {
    for (const over of [{ real_sub: undefined }, { tipo: 'SuperAdmin' }, { tipo: 'Empresa' }]) {
      const r = await ejecutar(protect, 'GET', tokenActAs(over));
      expect(statusDe(r)).toBe(401);
      expect(r.req.user).toBeUndefined();
    }
  });

  it('un token normal sigue pudiendo escribir y no recibe actAs', async () => {
    const r = await ejecutar(protect, 'POST', tokenNormal());
    expect(r.nextCalled).toBe(true);
    expect(r.nextError).toBeUndefined();
    expect(r.req.user).toMatchObject({ id: 'U1', tipo: 'Admin' });
    expect(r.req.actAs).toBeUndefined();
  });

  it('sin token sigue respondiendo 401', async () => {
    const r = await ejecutar(protect, 'GET');
    expect(statusDe(r)).toBe(401);
  });
});

describe('alcance del rol elegido con authorizeRoles', () => {
  it('un token "ver como" Cliente no pasa un gate de SuperAdmin', async () => {
    const r = await ejecutar(protectV2 as Handler, 'GET', tokenActAs());
    const gate = authorizeRoles('SuperAdmin');
    let err: { status?: number } | undefined;
    gate(
      r.req as unknown as Request,
      {} as Response,
      ((e?: { status?: number }) => {
        err = e;
      }) as NextFunction,
    );
    expect(err?.status).toBe(403);
  });
});

describe('audit_log con "ver como"', () => {
  const insertDe = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'));

  let queryMock: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    queryMock = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('record() guarda al SuperAdmin real como impersonator_id', async () => {
    await audit.record({
      req: { ip: '10.0.0.1', headers: {}, actAs: { realUserId: 'SA001' } },
      action: 'x.y',
      actorId: VIEW_AS_USER_ID,
      actorTipo: 'Cliente',
    });
    const insert = insertDe(queryMock);
    expect(String(insert?.[0])).toContain('impersonator_id');
    const params = insert?.[1] as unknown[];
    expect(params[0]).toBe(VIEW_AS_USER_ID);
    expect(params[11]).toBe('SA001');
  });

  it('record() deja impersonator_id en null sin "ver como"', async () => {
    await audit.record({ req: { ip: '10.0.0.1', headers: {} }, action: 'x.y', actorId: 'U1' });
    const params = insertDe(queryMock)?.[1] as unknown[];
    expect(params[11]).toBeNull();
  });

  it('auditMutations registra el intento bloqueado con lo que protect deja en req (orden real: ver actAsAudit.test.ts)', async () => {
    const mw = audit.auditMutations(() => ({ action: 'alerta.create', targetType: 'alerta' }));
    const res = Object.assign(new EventEmitter(), { statusCode: 403 });
    // req.user / req.actAs salen de ejecutar protect de verdad, no armados a mano.
    const rechazo = await ejecutar(protectV2 as Handler, 'POST', tokenActAs());
    const req = {
      method: 'POST',
      originalUrl: '/api/alertas',
      ip: '10.0.0.1',
      headers: {},
      body: { nombre: 'x' },
      user: rechazo.req.user,
      actAs: rechazo.req.actAs,
    };
    await new Promise<void>((resolve) => {
      void mw(req as unknown as Request, res as unknown as Response, () => {
        res.emit('finish');
        setImmediate(resolve);
      });
    });
    const params = insertDe(queryMock)?.[1] as unknown[];
    expect(params[3]).toBe('alerta.create');
    expect(params[9]).toBe(403);
    expect(params[11]).toBe('SA001');
  });
});
