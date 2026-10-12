/**
 * "Ver como" de SuperAdmin — emisión del token (POST /api/v2/auth/view-as).
 *
 * Sin base de datos: el repo se simula y el audit_log se observa espiando
 * `pool.query` (el INSERT que arma `auditLog.record`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

// appConfig valida el entorno con zod al importarse.
vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

const repo = vi.hoisted(() => ({
  findEmpresaById: vi.fn(),
  findSubEmpresaById: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserPublicByEmail: vi.fn(),
  storeOtp: vi.fn(),
  consumeOtpIfMatches: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock('../repo', () => repo);

import { viewAsHandler } from '../controller';
import { VIEW_AS_TTL_SECONDS, VIEW_AS_USER_ID } from '../../../services/actAs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pool = require('../../../config/db.js') as { query: (...a: unknown[]) => Promise<unknown> };

const SECRET = process.env.JWT_SECRET as string;

interface Ejecucion {
  status: number | undefined;
  body: unknown;
  error: { status?: number; message?: string } | undefined;
}

async function pedir(
  user: Record<string, unknown> | undefined,
  body: unknown,
  actAs?: { realUserId: string },
): Promise<Ejecucion> {
  const out: Ejecucion = { status: undefined, body: undefined, error: undefined };
  const req = { user, actAs, body, ip: '10.0.0.1', headers: { 'user-agent': 'vitest' } };
  const res = {
    locals: {} as Record<string, unknown>,
    json(b: unknown) {
      out.status = 200;
      out.body = b;
      return this;
    },
  };
  const next: NextFunction = (err?: unknown) => {
    out.error = err as Ejecucion['error'];
  };
  await viewAsHandler(req as unknown as Request, res as unknown as Response, next);
  return out;
}

const SUPERADMIN = { id: 'SA001', email: 'root@emeltec.cl', tipo: 'SuperAdmin' };

describe('POST /auth/view-as', () => {
  let queryMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock = vi.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 0 });
    repo.findEmpresaById.mockResolvedValue({ id: 'E1' });
    repo.findSubEmpresaById.mockResolvedValue({ id: 'S1', empresa_id: 'E1' });
  });

  it.each(['Admin', 'Gerente', 'Cliente', 'Vendedor'])(
    'un usuario %s recibe 403 al pedir "ver como"',
    async (tipo) => {
      const r = await pedir({ id: 'U1', tipo }, { role: 'Cliente', empresa_id: 'E1' });
      expect(r.error?.status).toBe(403);
      expect(r.body).toBeUndefined();
    },
  );

  it('un token "ver como" no puede emitir otro (sin encadenar)', async () => {
    const r = await pedir(
      { id: VIEW_AS_USER_ID, tipo: 'Admin', act_as: true, real_sub: 'SA001' },
      { role: 'Cliente', empresa_id: 'E1' },
      { realUserId: 'SA001' },
    );
    expect(r.error?.status).toBe(403);
    expect(r.body).toBeUndefined();
  });

  it('rechaza el intento encadenado aunque el tipo fuese SuperAdmin', async () => {
    const r = await pedir(
      SUPERADMIN,
      { role: 'Cliente', empresa_id: 'E1' },
      { realUserId: 'SA001' },
    );
    expect(r.error?.status).toBe(403);
  });

  it('emite un token HS256 de 30 minutos con los claims esperados', async () => {
    const r = await pedir(SUPERADMIN, { role: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'S1' });
    expect(r.status).toBe(200);
    const data = (r.body as { ok: boolean; data: Record<string, unknown> }).data;
    expect(data.expires_in).toBe(VIEW_AS_TTL_SECONDS);
    expect(data.view_as).toEqual({ tipo: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'S1' });

    const header = jwt.decode(data.token as string, { complete: true })?.header;
    expect(header?.alg).toBe('HS256');

    const claims = jwt.verify(data.token as string, SECRET, { algorithms: ['HS256'] }) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      id: VIEW_AS_USER_ID,
      email: 'root@emeltec.cl',
      tipo: 'Cliente',
      empresa_id: 'E1',
      sub_empresa_id: 'S1',
      act_as: true,
      real_sub: 'SA001',
    });
    expect((claims.exp as number) - (claims.iat as number)).toBe(30 * 60);
  });

  it('Admin: ignora sub_empresa_id (alcance de toda la empresa)', async () => {
    const r = await pedir(SUPERADMIN, { role: 'Admin', empresa_id: 'E1', sub_empresa_id: 'S1' });
    const data = (r.body as { data: { view_as: Record<string, unknown> } }).data;
    expect(data.view_as.sub_empresa_id).toBeNull();
    expect(repo.findSubEmpresaById).not.toHaveBeenCalled();
  });

  it('Gerente sin sub_empresa_id ve toda la empresa', async () => {
    const r = await pedir(SUPERADMIN, { role: 'Gerente', empresa_id: 'E1' });
    const data = (r.body as { data: { view_as: Record<string, unknown> } }).data;
    expect(data.view_as).toEqual({ tipo: 'Gerente', empresa_id: 'E1', sub_empresa_id: null });
  });

  it('Vendedor no necesita empresa y su token no lleva el id del SuperAdmin', async () => {
    const r = await pedir(SUPERADMIN, { role: 'Vendedor' });
    const data = (r.body as { data: { token: string } }).data;
    const claims = jwt.verify(data.token, SECRET) as Record<string, unknown>;
    expect(claims.tipo).toBe('Vendedor');
    expect(claims.empresa_id).toBeNull();
    // Con el id real heredaría las asignaciones usuario_sitio del SuperAdmin.
    expect(claims.id).toBe(VIEW_AS_USER_ID);
    expect(claims.id).not.toBe('SA001');
  });

  it('rechaza roles fuera del conjunto simulable (incluido SuperAdmin)', async () => {
    for (const role of ['SuperAdmin', 'Empresa', 'xyz']) {
      const r = await pedir(SUPERADMIN, { role, empresa_id: 'E1' });
      expect(r.error?.status).toBe(422);
    }
  });

  it('exige empresa_id para Admin/Gerente/Cliente', async () => {
    const r = await pedir(SUPERADMIN, { role: 'Cliente' });
    expect(r.error?.status).toBe(422);
  });

  it('rechaza una empresa inexistente', async () => {
    repo.findEmpresaById.mockResolvedValue(null);
    const r = await pedir(SUPERADMIN, { role: 'Admin', empresa_id: 'NOPE' });
    expect(r.error?.status).toBe(422);
  });

  it('rechaza una sub-empresa que no pertenece a la empresa', async () => {
    repo.findSubEmpresaById.mockResolvedValue({ id: 'S9', empresa_id: 'OTRA' });
    const r = await pedir(SUPERADMIN, { role: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'S9' });
    expect(r.error?.status).toBe(422);
    expect(r.body).toBeUndefined();
  });

  it('registra la emisión en audit_log con el SuperAdmin como actor', async () => {
    await pedir(SUPERADMIN, { role: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'S1' });
    const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'));
    expect(insert).toBeDefined();
    const params = insert?.[1] as unknown[];
    expect(params[0]).toBe('SA001'); // actor_id
    expect(params[1]).toBe('root@emeltec.cl');
    expect(params[2]).toBe('SuperAdmin');
    expect(params[3]).toBe('auth.view_as.issue');
    expect(params[5]).toBe('S1'); // target_id
    expect(JSON.parse(params[10] as string)).toMatchObject({
      view_as_tipo: 'Cliente',
      empresa_id: 'E1',
      sub_empresa_id: 'S1',
    });
  });

  it('no registra auditoría ni emite token cuando la validación falla', async () => {
    repo.findEmpresaById.mockResolvedValue(null);
    await pedir(SUPERADMIN, { role: 'Admin', empresa_id: 'NOPE' });
    const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'));
    expect(insert).toBeUndefined();
  });
});
