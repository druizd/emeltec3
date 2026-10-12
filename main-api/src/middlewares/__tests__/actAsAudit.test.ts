/**
 * "Ver como" de extremo a extremo con Express real: `auditMutations` montado
 * ANTES del `protect` (como en app.js), igual que en producción.
 *
 * Comprueba que una escritura bloqueada (403) queda en audit_log con el actor
 * simulado y el SuperAdmin real como `impersonator_id`. Los tests de unidad de
 * actAs.test.ts arman `req.user` a mano y no ven el orden real de los middlewares.
 * También cubre tokens vencidos y firmados con otro algoritmo.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';

// appConfig valida el entorno con zod al importarse.
vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

const SECRET = process.env.JWT_SECRET as string;

vi.mock('../../services/sessionRevocation', () => ({
  isSessionRevoked: vi.fn(async () => false),
}));

import { protect as protectV2 } from '../auth';
import { READ_ONLY_ERROR, VIEW_AS_USER_ID } from '../../services/actAs';

/* eslint-disable @typescript-eslint/no-require-imports */
const protectLegacy = (require('../authMiddleware.js') as { protect: RequestHandler }).protect;
const sessionRevocation = require('../../services/sessionRevocation.js') as {
  _setPool: (p: unknown) => void;
  _resetCache: () => void;
};
const { auditMutations } = require('../../services/auditLog.js') as {
  auditMutations: (r: (req: unknown) => Record<string, unknown>) => RequestHandler;
};
const pool = require('../../config/db.js') as { query: (...a: unknown[]) => Promise<unknown> };
/* eslint-enable @typescript-eslint/no-require-imports */

const tokenActAs = (opts: jwt.SignOptions = { expiresIn: 1800 }, secretAlg = 'HS256'): string =>
  jwt.sign(
    {
      id: VIEW_AS_USER_ID,
      email: 'root@emeltec.cl',
      tipo: 'Cliente',
      empresa_id: 'E1',
      sub_empresa_id: 'S1',
      act_as: true,
      real_sub: 'SA001',
    },
    SECRET,
    { algorithm: secretAlg as jwt.Algorithm, ...opts },
  );

describe.each([
  ['legacy (authMiddleware.js)', protectLegacy],
  ['v2 (auth.ts)', protectV2 as RequestHandler],
])('"ver como" extremo a extremo con protect %s', (_nombre, protect) => {
  let server: Server;
  let base: string;
  let handler: ReturnType<typeof vi.fn>;
  let queryMock: ReturnType<typeof vi.spyOn>;

  const insertDe = () =>
    queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'));

  /** El INSERT corre tras el evento `finish`, ya respondida la petición. */
  const esperarInsert = async () => {
    await vi.waitFor(() => expect(insertDe()).toBeDefined());
    return insertDe()?.[1] as unknown[];
  };

  const enviar = (method: string, token: string) =>
    fetch(`${base}/api/recurso`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ nombre: 'x' }) }),
    });

  beforeEach(async () => {
    queryMock = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
    sessionRevocation._resetCache();
    sessionRevocation._setPool({ query: vi.fn().mockResolvedValue({ rows: [{}] }) });
    handler = vi.fn((_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const app = express();
    app.use(express.json());
    app.use(
      '/api/recurso',
      auditMutations(() => ({ action: 'recurso.write', targetType: 'recurso' })),
      protect,
      handler as unknown as RequestHandler,
    );
    // Equivale al manejador de errores de v2: el protect v2 entrega AppError por next.
    app.use(
      (
        err: { status?: number; message?: string },
        _q: Request,
        res: Response,
        _n: NextFunction,
      ) => {
        res.status(err.status ?? 500).json({ ok: false, error: err.message });
      },
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  it('POST con token "ver como": 403, sin ejecutar el handler y auditado con el suplantador', async () => {
    const res = await enviar('POST', tokenActAs());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: READ_ONLY_ERROR });
    expect(handler).not.toHaveBeenCalled();

    const params = await esperarInsert();
    expect(params[0]).toBe(VIEW_AS_USER_ID); // actor_id
    expect(params[2]).toBe('Cliente'); // actor_tipo
    expect(params[3]).toBe('recurso.write'); // action
    expect(params[9]).toBe(403); // status_code
    expect(JSON.parse(params[10] as string)).toMatchObject({ outcome: 'denied' });
    expect(params[11]).toBe('SA001'); // impersonator_id
  });

  it('un token vencido responde 401 y no ejecuta el handler', async () => {
    const vencido = tokenActAs({ expiresIn: -10 });
    const res = await enviar('POST', vencido);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('un token firmado con otro algoritmo (HS512) responde 401', async () => {
    const res = await enviar('GET', tokenActAs({ expiresIn: 1800 }, 'HS512'));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('GET con token "ver como" llega al handler', async () => {
    const res = await enviar('GET', tokenActAs());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
