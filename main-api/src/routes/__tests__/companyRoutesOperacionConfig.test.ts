/**
 * Control de rol de `/api/companies/sites/:siteId/operacion-config`.
 *
 * Los turnos y la jornada definen cómo se calcula la operación del sitio: solo
 * SuperAdmin y Admin pueden cambiarlos (PUT). Cualquiera con acceso al sitio
 * puede leerlos (GET). Se monta el router REAL de companyRoutes con tokens
 * firmados; el controller compilado (dist) se sustituye por un stub porque en
 * test no hay build.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import Module from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

const SECRET = process.env.JWT_SECRET as string;

/* eslint-disable @typescript-eslint/no-require-imports */
const sessionRevocation = require('../../services/sessionRevocation.js') as {
  _setPool: (p: unknown) => void;
  _resetCache: () => void;
};
const pool = require('../../config/db.js') as { query: (...a: unknown[]) => Promise<unknown> };
/* eslint-enable @typescript-eslint/no-require-imports */

const stubController = {
  getSiteOperacionConfigHandler: (_req: Request, res: Response) => {
    res.json({ ok: true, op: 'get' });
  },
  updateSiteOperacionConfigHandler: (_req: Request, res: Response) => {
    res.json({ ok: true, op: 'put' });
  },
};

type ModuleWithRequire = { prototype: { require: (id: string) => unknown } };
const moduleProto = (Module as unknown as ModuleWithRequire).prototype;
const originalRequire = moduleProto.require;

const token = (tipo: string): string =>
  jwt.sign(
    { id: `U-${tipo}`, email: 'a@b.cl', tipo, empresa_id: 'E1', sub_empresa_id: 'S1' },
    SECRET,
    {
      expiresIn: 600,
    },
  );

describe('PUT/GET /api/companies/sites/:siteId/operacion-config', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    // El router carga el controller desde dist/ con require perezoso.
    moduleProto.require = function (this: unknown, id: string) {
      if (
        id
          .split(String.fromCharCode(92))
          .join('/')
          .endsWith('dist/modules/siteOperacionConfig/controller')
      ) {
        return stubController;
      }
      return originalRequire.call(this, id);
    };
    vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ empresa_id: 'E1', sub_empresa_id: 'S1' }],
      rowCount: 1,
    });
    sessionRevocation._resetCache();
    sessionRevocation._setPool({ query: vi.fn().mockResolvedValue({ rows: [{}] }) });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const router = require('../companyRoutes.js') as RequestHandler;
    const app = express();
    app.use(express.json());
    app.use('/api/companies', router);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    moduleProto.require = originalRequire;
    sessionRevocation._setPool(null);
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const llamar = (method: 'GET' | 'PUT', tipo: string) =>
    fetch(`${base}/api/companies/sites/SITE1/operacion-config`, {
      method,
      headers: { authorization: `Bearer ${token(tipo)}`, 'content-type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify({ turnos: [] }) } : {}),
    });

  it.each(['Gerente', 'Cliente', 'Vendedor'])('PUT responde 403 al rol %s', async (tipo) => {
    const res = await llamar('PUT', tipo);
    expect(res.status).toBe(403);
  });

  it.each(['SuperAdmin', 'Admin'])('PUT responde 200 al rol %s', async (tipo) => {
    const res = await llamar('PUT', tipo);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, op: 'put' });
  });

  it('GET sigue permitido para Cliente', async () => {
    const res = await llamar('GET', 'Cliente');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, op: 'get' });
  });
});
