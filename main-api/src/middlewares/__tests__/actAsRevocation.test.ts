/**
 * Revocación de sesión con la DB caída, con Express real y los dos `protect`.
 *
 * Los tokens "ver como" fallan CERRADOS (401): un token de suplantación revocado
 * no puede seguir sirviendo por un corte de la base. Los tokens normales siguen
 * fallando abiertos para que un hipo de la DB no cierre todas las sesiones.
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

const tokenActAs = (): string =>
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
    { expiresIn: 1800 },
  );

const tokenNormal = (): string =>
  jwt.sign({ id: 'U1', email: 'a@b.cl', tipo: 'Cliente', empresa_id: 'E1' }, SECRET, {
    expiresIn: 1800,
  });

describe.each([
  ['legacy (authMiddleware.js)', protectLegacy],
  ['v2 (auth.ts)', protectV2 as RequestHandler],
])('revocación con la DB caída, protect %s', (_nombre, protect) => {
  let server: Server;
  let base: string;
  let handler: ReturnType<typeof vi.fn>;

  const get = (token: string) =>
    fetch(`${base}/api/recurso`, { headers: { authorization: `Bearer ${token}` } });

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionRevocation._resetCache();
    sessionRevocation._setPool({ query: vi.fn().mockRejectedValue(new Error('conexion caida')) });
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

  it('GET con token "ver como": 401 y no ejecuta el handler', async () => {
    const res = await get(tokenActAs());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('GET con token normal: sigue pasando (falla abierto)', async () => {
    const res = await get(tokenNormal());
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
