import { Pool, type PoolConfig } from 'pg';
import { config } from '../../shared/env';
import { logger } from '../../shared/logger';

const poolConfig: PoolConfig = {
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  options: '-c timezone=UTC',
  statement_timeout: config.db.statementTimeoutMs,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error({ err }, '[db] error inesperado en pool');
});

export async function pingDb(): Promise<boolean> {
  try {
    const res = await pool.query('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  } catch (err) {
    logger.error({ err }, '[db] ping falló');
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
