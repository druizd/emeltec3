/**
 * `statementTimeoutMs` en `query()`: sube el límite SOLO para esa consulta.
 *
 * Lo que importa verificar no es que el número llegue, sino que NO se escape:
 * un `SET` a secas sobre un cliente del pool se lo lleva la siguiente query
 * ajena que toque esa conexión. Por eso va `SET LOCAL` dentro de una
 * transacción propia, y por eso estos tests miran la secuencia completa de SQL
 * y que el cliente se libere siempre.
 *
 * El pool se siembra en `require.cache` ANTES de importar dbHelpers, porque
 * dbHelpers hace `require('./db.js')` al cargarse y `vi.mock` no intercepta
 * ese require (mismo motivo que en controllers/__tests__/rolScope.test.ts).
 * De ahí el `await import()` dinámico: un `import` estático se hoistea por
 * encima de la siembra y la deja inútil.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbHelpers from '../dbHelpers.js';

// appConfig valida el entorno con zod al importarse, y dbHelpers lo importa.
process.env.DB_PASSWORD ??= 'test-password';
process.env.JWT_SECRET ??= 'clave-de-test-para-vitest-0123456789';
process.env.DGA_ENCRYPTION_KEY ??= 'clave-aes-256-de-test-0123456789ABCDEF';

interface Ejecutada {
  sql: string;
}

let sqlDelCliente: Ejecutada[] = [];
let sqlDelPool: Ejecutada[] = [];
let liberaciones = 0;
/** Si está seteado, la query de datos (no BEGIN/SET/COMMIT) revienta. */
let fallaLaQuery: Error | null = null;

function textoDe(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'text' in arg)
    return String((arg as { text: string }).text);
  return String(arg);
}

const esControl = (sql: string) => /^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql.trim());

const poolFalso = {
  on: () => undefined,
  query: async (arg: unknown) => {
    sqlDelPool.push({ sql: textoDe(arg) });
    return { rows: [], rowCount: 0 };
  },
  connect: async () => ({
    query: async (arg: unknown) => {
      const sql = textoDe(arg);
      sqlDelCliente.push({ sql });
      if (fallaLaQuery && !esControl(sql)) throw fallaLaQuery;
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      liberaciones += 1;
    },
  }),
};

const require_ = createRequire(path.join(process.cwd(), 'vitest-require-root.js'));
for (const mod of ['./src/config/db']) {
  const p = require_.resolve(mod);
  require_.cache[p] = { id: p, filename: p, loaded: true, exports: poolFalso } as never;
}

// El import es dinámico y dentro de `beforeAll` por dos razones: la siembra de
// arriba tiene que correr antes, y un `await` de nivel superior no compila bajo
// `moduleResolution: node16`.
let query: typeof DbHelpers.query;

beforeAll(async () => {
  ({ query } = await import('../dbHelpers.js'));
});

beforeEach(() => {
  sqlDelCliente = [];
  sqlDelPool = [];
  liberaciones = 0;
  fallaLaQuery = null;
});

describe('query() con statementTimeoutMs', () => {
  it('sin la opción no abre transacción: va directo al pool', async () => {
    await query('SELECT 1', [], { label: 'sin_timeout' });

    expect(sqlDelPool.map((e) => e.sql)).toEqual(['SELECT 1']);
    expect(sqlDelCliente).toEqual([]);
    expect(liberaciones).toBe(0);
  });

  it('con la opción envuelve en BEGIN / SET LOCAL / COMMIT sobre un cliente propio', async () => {
    await query('SELECT 2', [], { label: 'con_timeout', statementTimeoutMs: 60_000 });

    expect(sqlDelCliente.map((e) => e.sql)).toEqual([
      'BEGIN',
      'SET LOCAL statement_timeout TO 60000',
      'SELECT 2',
      'COMMIT',
    ]);
    // Nada por el pool compartido: la conexión con el timeout subido es otra.
    expect(sqlDelPool).toEqual([]);
    expect(liberaciones).toBe(1);
  });

  it('es SET LOCAL y no SET: el valor muere con la transacción', async () => {
    await query('SELECT 3', [], { statementTimeoutMs: 1_000 });

    const set = sqlDelCliente.find((e) => e.sql.includes('statement_timeout'));
    expect(set?.sql).toMatch(/^SET LOCAL /);
  });

  it('si la query falla hace ROLLBACK, libera el cliente y propaga el error', async () => {
    fallaLaQuery = new Error('canceling statement due to statement timeout');

    await expect(query('SELECT 4', [], { statementTimeoutMs: 60_000 })).rejects.toThrow(
      'canceling statement due to statement timeout',
    );

    expect(sqlDelCliente.map((e) => e.sql)).toEqual([
      'BEGIN',
      'SET LOCAL statement_timeout TO 60000',
      'SELECT 4',
      'ROLLBACK',
    ]);
    expect(liberaciones).toBe(1);
  });

  it('fuerza el valor a entero positivo antes de interpolarlo', async () => {
    // El valor se interpola porque `SET LOCAL` no acepta placeholders, así que
    // no puede llegar nada que no sea un entero.
    await query('SELECT 5', [], { statementTimeoutMs: 1_500.9 });
    await query('SELECT 6', [], { statementTimeoutMs: 0 });
    await query('SELECT 7', [], { statementTimeoutMs: -10 });

    const sets = sqlDelCliente.filter((e) => e.sql.includes('statement_timeout')).map((e) => e.sql);
    expect(sets).toEqual([
      'SET LOCAL statement_timeout TO 1500',
      'SET LOCAL statement_timeout TO 1',
      'SET LOCAL statement_timeout TO 1',
    ]);
    for (const s of sets) expect(s).toMatch(/^SET LOCAL statement_timeout TO \d+$/);
  });
});
