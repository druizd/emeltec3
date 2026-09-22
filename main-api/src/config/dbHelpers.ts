/**
 * Helpers tipados de DB sobre el pool legacy `config/db.js`.
 * Añade statement_timeout, slow-log y prom-client.
 */
import type { Pool, PoolClient, QueryConfig, QueryResult, QueryResultRow } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const legacyPool = require('./db.js') as Pool;
import { config } from './appConfig';
import { logger } from './logger';
import { dbQueryDuration } from './metrics';

const SLOW_LOG_MS = config.db.slowLogMs;
const STATEMENT_TIMEOUT_MS = config.db.statementTimeoutMs;

let timeoutsApplied = false;
function applyConnectionDefaults(): void {
  if (timeoutsApplied) return;
  timeoutsApplied = true;
  if (typeof (legacyPool as Pool).on !== 'function') return;
  legacyPool.on('connect', (client: PoolClient) => {
    client
      .query(`SET statement_timeout TO ${STATEMENT_TIMEOUT_MS}`)
      .catch((err: Error) =>
        logger.warn({ err: err.message }, 'No se pudo setear statement_timeout'),
      );
  });
}
applyConnectionDefaults();

export interface QueryOptions {
  name?: string;
  label?: string;
  /**
   * Sube el `statement_timeout` SOLO para esta query. Para procesos de fondo
   * que barren meses enteros, donde el limite global de 10s protege a un
   * usuario que no existe.
   *
   * Se aplica con `SET LOCAL` dentro de una transaccion propia: el valor
   * muere en el COMMIT, asi la conexion vuelve al pool con el timeout global
   * intacto. Un `SET` a secas sobre un cliente del pool se lo llevaria la
   * siguiente query ajena que toque esa conexion.
   */
  statementTimeoutMs?: number;
}

/**
 * Ejecuta `cfg` en una transaccion propia con el `statement_timeout` subido.
 * Cliente dedicado para no contaminar el pool.
 */
async function queryWithTimeout<R extends QueryResultRow>(
  cfg: QueryConfig<unknown[]>,
  timeoutMs: number,
): Promise<QueryResult<R>> {
  // Interpolado, no parametrizado: `SET LOCAL` no acepta placeholders. De ahi
  // que el valor se fuerce a entero positivo antes de tocar el SQL.
  const ms = Math.max(1, Math.floor(timeoutMs));
  if (!Number.isFinite(ms)) throw new Error(`statementTimeoutMs invalido: ${timeoutMs}`);

  const client = await legacyPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout TO ${ms}`);
    const result = await client.query<R>(cfg);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string | QueryConfig<unknown[]>,
  values?: unknown[],
  opts: QueryOptions = {},
): Promise<QueryResult<R>> {
  const startedAt = process.hrtime.bigint();
  const cfg: QueryConfig<unknown[]> =
    typeof text === 'string'
      ? { text, values: values ?? [], ...(opts.name ? { name: opts.name } : {}) }
      : text;
  const queryName = cfg.name ?? opts.label ?? 'inline';

  try {
    const result =
      opts.statementTimeoutMs === undefined
        ? await legacyPool.query<R>(cfg)
        : await queryWithTimeout<R>(cfg, opts.statementTimeoutMs);
    const durationNs = Number(process.hrtime.bigint() - startedAt);
    const durationMs = Math.round(durationNs / 1e6);
    dbQueryDuration.observe({ name: queryName, status: 'ok' }, durationNs / 1e9);
    if (durationMs >= SLOW_LOG_MS) {
      logger.warn({ durationMs, rows: result.rowCount, name: queryName }, 'DB slow query');
    }
    return result;
  } catch (err) {
    const durationNs = Number(process.hrtime.bigint() - startedAt);
    dbQueryDuration.observe({ name: queryName, status: 'error' }, durationNs / 1e9);
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(durationNs / 1e6),
        name: queryName,
      },
      'DB query falló',
    );
    throw err;
  }
}

export function getClient(): Promise<PoolClient> {
  return legacyPool.connect();
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await legacyPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export { legacyPool as pool };
