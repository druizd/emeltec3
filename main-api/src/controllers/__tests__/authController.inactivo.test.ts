/**
 * Login v1: un usuario con `activo = false` recibe exactamente la misma
 * respuesta (estado y cuerpo) que con credenciales inválidas.
 *
 * El pool se sustituye vía `require.cache`, NO con `vi.mock` (authController es
 * CommonJS). Mismo patrón que companyController.serial.test.ts.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';

vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

type Fila = Record<string, unknown>;

let filas: Fila[] = [];

const require_ = createRequire(path.join(process.cwd(), 'vitest-require-root.js'));

const dbPath = require_.resolve('./src/config/db');
require_.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql: string) => ({
      rows: sql.trimStart().startsWith('SELECT') ? filas : [],
      rowCount: filas.length,
    }),
  },
} as unknown as NodeJS.Module;

const controller = require_('./src/controllers/authController') as {
  login: (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
};

const CLAVE = 'clave-correcta';
let hash = '';

beforeAll(async () => {
  hash = await bcrypt.hash(CLAVE, 4);
});

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

async function intentar(password: string) {
  const res = makeRes();
  const next = vi.fn();
  await controller.login({ body: { email: 'ana@emeltec.cl', password } }, res, next);
  expect(next).not.toHaveBeenCalled();
  return { status: res.statusCode, body: res.body };
}

const usuario = (extra: Fila): Fila => ({
  id: 'U1',
  nombre: 'Ana',
  email: 'ana@emeltec.cl',
  tipo: 'Cliente',
  empresa_id: 'E1',
  sub_empresa_id: null,
  password_hash: hash,
  otp_hash: null,
  otp_expires_at: null,
  ...extra,
});

describe('login v1 con usuarios inactivos', () => {
  beforeEach(() => {
    filas = [];
  });

  it('un usuario activo inicia sesión', async () => {
    filas = [usuario({ activo: true })];
    expect((await intentar(CLAVE)).status).toBe(200);
  });

  it('activo NULL cuenta como activo', async () => {
    filas = [usuario({ activo: null })];
    expect((await intentar(CLAVE)).status).toBe(200);
  });

  it('un inactivo con la contraseña correcta recibe lo mismo que credenciales inválidas', async () => {
    filas = [];
    const inexistente = await intentar(CLAVE);

    filas = [usuario({ activo: true })];
    const claveMala = await intentar('otra-clave');

    filas = [usuario({ activo: false })];
    const inactivo = await intentar(CLAVE);

    expect(inactivo.status).toBe(401);
    expect(inactivo).toEqual(claveMala);
    expect(inactivo).toEqual(inexistente);
  });

  it('un inactivo con OTP correcto tampoco entra', async () => {
    const otp = await bcrypt.hash('ABC123', 4);
    filas = [usuario({ activo: false, password_hash: null, otp_hash: otp })];
    const r = await intentar('ABC123');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ ok: false, error: 'Credenciales inválidas' });
  });
});
