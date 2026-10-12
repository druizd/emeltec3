/**
 * Los dos `protect` solo aceptan tokens de sesión: con `id` y `tipo`, y sin
 * `purpose`. Los tokens de propósito (MFA, activación, restablecimiento) los
 * firma auth-api con el mismo secreto y NO son una sesión.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

// vi.mock solo intercepta el import de `auth.ts`; el legacy (CJS) usa el pool simulado.
vi.mock('../../services/sessionRevocation', () => ({
  isSessionRevoked: async () => false,
}));

const SECRET = process.env.JWT_SECRET as string;

import { protect as protectV2 } from '../auth';
import { VIEW_AS_USER_ID } from '../../services/actAs';

/* eslint-disable @typescript-eslint/no-require-imports */
const protectLegacy = (require('../authMiddleware.js') as { protect: RequestHandler }).protect;
const sessionRevocation = require('../../services/sessionRevocation.js') as {
  _setPool: (p: unknown) => void;
  _resetCache: () => void;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const firmar = (claims: Record<string, unknown>): string =>
  jwt.sign(claims, SECRET, { expiresIn: 1800 });

const sesion = { id: 'U1', email: 'a@b.cl', tipo: 'Cliente', empresa_id: 'E1' };

describe.each([
  ['legacy (authMiddleware.js)', protectLegacy],
  ['v2 (auth.ts)', protectV2 as RequestHandler],
])('tokens aceptados por protect %s', (_nombre, protect) => {
  let server: Server;
  let base: string;
  let handler: ReturnType<typeof vi.fn>;

  const get = (token: string) =>
    fetch(`${base}/api/recurso`, { headers: { authorization: `Bearer ${token}` } });

  beforeEach(async () => {
    sessionRevocation._resetCache();
    sessionRevocation._setPool({ query: vi.fn().mockResolvedValue({ rows: [] }) });
    handler = vi.fn((_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    const app = express();
    app.use('/api/recurso', protect, handler as unknown as RequestHandler);
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
    sessionRevocation._setPool(null);
    vi.restoreAllMocks();
  });

  it.each(['mfa', 'account_setup', 'password_reset'])(
    'rechaza con 401 un token de propósito %s',
    async (purpose) => {
      const res = await get(firmar({ email: 'a@b.cl', purpose }));
      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('rechaza con 401 un token con `purpose` aunque lleve id y tipo', async () => {
    const res = await get(firmar({ ...sesion, purpose: 'mfa' }));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rechaza con 401 un token sin id', async () => {
    const res = await get(firmar({ email: 'a@b.cl', tipo: 'Cliente' }));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rechaza con 401 un token sin tipo', async () => {
    const res = await get(firmar({ id: 'U1', email: 'a@b.cl' }));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('acepta una sesión normal', async () => {
    const res = await get(firmar(sesion));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('acepta un token "ver como" vigente (GET)', async () => {
    const res = await get(
      firmar({
        id: VIEW_AS_USER_ID,
        email: 'root@emeltec.cl',
        tipo: 'Cliente',
        empresa_id: 'E1',
        sub_empresa_id: null,
        act_as: true,
        real_sub: 'SA001',
      }),
    );
    expect(res.status).toBe(200);
  });
});
