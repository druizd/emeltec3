/**
 * Cambiar el rol o desactivar a un usuario corta sus sesiones abiertas
 * (`sessions_valid_from = NOW()`); editar cualquier otro campo no.
 *
 * El pool se sustituye vía `require.cache`, NO con `vi.mock`: userController es
 * CommonJS y `vi.mock` no intercepta su `require`. Mismo patrón que
 * companyController.serial.test.ts.
 *
 * userController hace `require('../config/dbHelpers')`, que solo existe como
 * .ts: se registra la extensión `.ts` para que Node lo resuelva y se sustituye
 * en `require.cache` (en producción corre desde dist/, donde es .js).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DB_PASSWORD ??= 'test-password';
  process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
  process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';
});

type Fila = Record<string, unknown>;

const consultas: { sql: string; params: unknown[] }[] = [];

/** Usuario objetivo tal como lo lee la verificación previa. */
const objetivo: Fila = { empresa_id: 'E1', sub_empresa_id: 'SE1', tipo: 'Cliente' };

const ejecutar = async (sql: string, params: unknown[] = []) => {
  consultas.push({ sql, params });
  if (sql.includes('FROM usuario WHERE id = $1') && sql.startsWith('SELECT')) {
    return { rows: [objetivo], rowCount: 1 };
  }
  if (sql.includes('WHERE u.id = $1')) return { rows: [{ id: 'U2', telefono: null }], rowCount: 1 };
  return { rows: [], rowCount: 1 };
};

const require_ = createRequire(path.join(process.cwd(), 'vitest-require-root.js'));

const sustituir = (ruta: string, exports: unknown): void => {
  const resuelta = require_.resolve(ruta);
  require_.cache[resuelta] = {
    id: resuelta,
    filename: resuelta,
    loaded: true,
    exports,
  } as unknown as NodeJS.Module;
};

// Sin esto Node no ve dbHelpers.ts; el cargador vacío nunca llega a ejecutarse
// porque el módulo queda sustituido en la caché.
require_.extensions['.ts'] = () => {};

sustituir('./src/config/db', {
  query: ejecutar,
  connect: async () => ({ query: ejecutar, release: () => {} }),
});
sustituir('./src/config/dbHelpers', { query: ejecutar, transaction: async () => undefined });

const controller = require_('./src/controllers/userController') as {
  updateUser: (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
  deleteUser: (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
};

const makeRes = () => {
  const res = {
    status: vi.fn((_code?: number) => res),
    json: vi.fn((_payload?: unknown) => res),
  };
  return res;
};

const superAdmin = { id: 'SA1', tipo: 'SuperAdmin' };

const escrituras = () => consultas.filter((c) => c.sql.includes('UPDATE usuario'));
const revoca = (c: { sql: string }) => c.sql.includes('sessions_valid_from = NOW()');

async function editar(body: Fila) {
  const res = makeRes();
  const next = vi.fn();
  await controller.updateUser({ params: { id: 'U2' }, user: superAdmin, body }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
}

describe('revocación de sesiones al editar usuarios', () => {
  beforeEach(() => {
    consultas.length = 0;
    objetivo.tipo = 'Cliente';
  });

  it('updateUser: cambiar el tipo revoca las sesiones', async () => {
    await editar({ tipo: 'Gerente' });
    expect(escrituras().some(revoca)).toBe(true);
  });

  it('updateUser: enviar el mismo tipo no revoca', async () => {
    await editar({ tipo: 'Cliente', nombre: 'Ana' });
    expect(escrituras()).toHaveLength(1);
    expect(escrituras().some(revoca)).toBe(false);
  });

  it('updateUser: desactivar (activo=false) revoca', async () => {
    await editar({ activo: false });
    expect(escrituras().some(revoca)).toBe(true);
  });

  it('updateUser: reactivar (activo=true) no revoca', async () => {
    await editar({ activo: true });
    expect(escrituras().some(revoca)).toBe(false);
  });

  it('updateUser: editar otros campos no revoca', async () => {
    await editar({ nombre: 'Ana', cargo: 'Jefa', telefono: '+56911112222' });
    expect(escrituras()).toHaveLength(1);
    expect(escrituras().some(revoca)).toBe(false);
  });

  it('deleteUser: desactivar siempre revoca', async () => {
    const res = makeRes();
    const next = vi.fn();
    await controller.deleteUser({ params: { id: 'U2' }, user: superAdmin }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(escrituras().some(revoca)).toBe(true);
  });
});
