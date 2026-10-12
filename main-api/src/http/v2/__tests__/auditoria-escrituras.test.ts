/**
 * Auditoría de escrituras del router v2 REAL (no un app armado a mano).
 *
 * En v1 `app.js` monta `auditMutations` antes de cada router, así que una
 * escritura rechazada por `protect` igual queda en audit_log. En v2 la
 * auditoría vivía por ruta y DESPUÉS de `protect`: un 403 de "ver como" (o de
 * `authorizeRoles`, o de 2FA) cortaba la cadena antes de llegar a ella y no
 * dejaba rastro. Ahora el router v2 audita al entrar, una sola vez por petición.
 *
 * Estos tests montan `routes.ts` tal cual y cuentan los INSERT a audit_log.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

const SECRET = process.env.JWT_SECRET as string;

vi.mock('../../../services/sessionRevocation', () => ({ isSessionRevoked: async () => false }));

vi.mock('../../../config/dbHelpers', () => ({
  query: async () => ({ rows: [], rowCount: 0 }),
  transaction: async () => undefined,
}));

// Los handlers no son lo que se prueba: responden 200 si la petición llega a ellos.
const { ok } = vi.hoisted(() => ({
  ok: (_req: unknown, res: { json: (b: unknown) => void }) => {
    res.json({ ok: true });
  },
}));
vi.mock('../../../modules/dga/controller', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  upsertInformanteHandler: ok,
}));
vi.mock('../../../modules/healthDigest/destinatariosController', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveDigestConfigHandler: ok,
}));

import { VIEW_AS_USER_ID } from '../../../services/actAs';
import routerV2 from '../routes';

/* eslint-disable @typescript-eslint/no-require-imports */
const pool = require('../../../config/db.js') as { query: (...a: unknown[]) => Promise<unknown> };
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

const tokenRol = (tipo: string): string =>
  jwt.sign(
    { id: `U-${tipo}`, email: 'a@b.cl', tipo, empresa_id: 'E1', sub_empresa_id: 'S1' },
    SECRET,
    {
      expiresIn: 1800,
    },
  );

describe('auditoría de escrituras en el router v2 real', () => {
  let server: Server;
  let base: string;
  let queryMock: ReturnType<typeof vi.spyOn>;

  const inserts = () =>
    queryMock.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO audit_log'));

  /** El INSERT corre tras el evento `finish`; se espera a que llegue y a que no sobren. */
  const insertsTrasResponder = async () => {
    await vi.waitFor(() => expect(inserts().length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    return inserts().map((c) => c[1] as unknown[]);
  };

  const enviar = (method: string, path: string, token: string) =>
    fetch(`${base}/api/v2${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'x' }),
    });

  beforeEach(async () => {
    queryMock = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
    const app = express();
    app.use(express.json());
    app.use('/api/v2', routerV2);
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

  it('PATCH de bitácora con token "ver como": 403 y una fila con el suplantador', async () => {
    const res = await enviar('PATCH', '/sites/bitacora/equipos/EQ999999', tokenActAs());
    expect(res.status).toBe(403);

    const filas = await insertsTrasResponder();
    expect(filas).toHaveLength(1);
    const params = filas[0]!;
    expect(params[0]).toBe(VIEW_AS_USER_ID); // actor_id
    expect(params[2]).toBe('Cliente'); // actor_tipo
    expect(params[3]).toBe('bitacora.equipo.patch'); // action
    expect(params[5]).toBe('EQ999999'); // target_id
    expect(params[9]).toBe(403); // status_code
    expect(params[11]).toBe('SA001'); // impersonator_id
  });

  it('una escritura rechazada por rol (authorizeRoles) también queda auditada, una vez', async () => {
    const res = await enviar('PUT', '/health-digest/config', tokenRol('Cliente'));
    expect(res.status).toBe(403);

    const filas = await insertsTrasResponder();
    expect(filas).toHaveLength(1);
    expect(filas[0]![3]).toBe('health_digest.config.update');
    expect(filas[0]![9]).toBe(403);
  });

  it('una escritura DGA ya auditada sigue generando una sola fila', async () => {
    const res = await enviar('PATCH', '/dga/informantes/11111111-1', tokenRol('SuperAdmin'));
    expect(res.status).toBe(200);

    const filas = await insertsTrasResponder();
    expect(filas).toHaveLength(1);
    expect(filas[0]![3]).toBe('dga.informante.upsert');
    expect(filas[0]![4]).toBe('dga_informante');
    expect(filas[0]![5]).toBe('11111111-1');
    expect(filas[0]![9]).toBe(200);
  });

  it('una escritura de digest ya auditada sigue generando una sola fila', async () => {
    const res = await enviar('PUT', '/health-digest/config', tokenRol('SuperAdmin'));
    expect(res.status).toBe(200);

    const filas = await insertsTrasResponder();
    expect(filas).toHaveLength(1);
    expect(filas[0]![3]).toBe('health_digest.config.update');
    expect(filas[0]![4]).toBe('health_digest_config');
    expect(filas[0]![5]).toBe('global');
  });

  it('las lecturas no generan filas de auditoría', async () => {
    const res = await fetch(`${base}/api/v2/companies/tree`, {
      headers: { authorization: `Bearer ${tokenRol('SuperAdmin')}` },
    });
    expect(res.status).toBeLessThan(500);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(inserts()).toHaveLength(0);
  });
});
