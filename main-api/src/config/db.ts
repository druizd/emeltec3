/**
 * Pool PostgreSQL/TimescaleDB compartido + helpers tipados.
 * Reglas:
 *  - statement_timeout por conexión (defensa contra queries colgadas)
 *  - slow-query log a pino para queries > DB_SLOW_LOG_MS
 *  - prepared statements vía `query({ name, text, values })`
 */
import { Pool, type PoolClient, type QueryConfig, type QueryResult, type QueryResultRow } from 'pg';
import { config } from './env';
import { logger } from './logger';
import { dbQueryDuration } from './metrics';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  options: '-c timezone=UTC',
});

const SLOW_LOG_MS = config.db.slowLogMs;
const STATEMENT_TIMEOUT_MS = config.db.statementTimeoutMs;

pool.on('error', (err) => logger.error({ err: err.message }, 'DB pool error'));
pool.on('connect', (client) => {
  client
    .query(`SET statement_timeout TO ${STATEMENT_TIMEOUT_MS}`)
    .catch((err: Error) =>
      logger.warn({ err: err.message }, 'No se pudo setear statement_timeout'),
    );
});

// Smoke connectivity check al boot.
pool
  .query('SELECT NOW()')
  .then(() => logger.info('DB conectada (TimescaleDB)'))
  .catch((err: Error) => logger.error({ err: err.message }, 'DB conexión falló'));

export interface QueryOptions {
  /** Nombre del prepared statement — habilita plan caching en pg. */
  name?: string;
  /** Etiqueta humana para logs (no la usa pg). */
  label?: string;
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
    const result = await pool.query<R>(cfg);
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
  return pool.connect();
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
