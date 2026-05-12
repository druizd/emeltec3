/**
 * Flusher periódico: vuelca el buffer in-memory a api_metrics / api_variable_metrics.
 * Idempotente: si no hay datos no toca la DB.
 */
import { query } from '../../config/dbHelpers';
import { logger } from '../../config/logger';
import { drainEndpoints, drainVariables, bufferSizes } from './buffer';

const DEFAULT_INTERVAL_MS = 5_000;

let timer: NodeJS.Timeout | null = null;
let flushing = false;

async function ensureTables(): Promise<void> {
  await query(
    `
    CREATE TABLE IF NOT EXISTS public.api_metrics (
      id SERIAL PRIMARY KEY,
      endpoint VARCHAR(200) NOT NULL,
      domain_slug VARCHAR(50),
      serial_id VARCHAR(100),
      request_count BIGINT DEFAULT 0,
      bytes_sent BIGINT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (endpoint, domain_slug, serial_id)
    );
    CREATE TABLE IF NOT EXISTS public.api_variable_metrics (
      id SERIAL PRIMARY KEY,
      nombre_dato VARCHAR(150) NOT NULL,
      serial_id VARCHAR(100),
      request_count BIGINT DEFAULT 0,
      bytes_sent BIGINT DEFAULT 0,
      duration_ms_total BIGINT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (nombre_dato, serial_id)
    );
    `,
    [],
    { label: 'metrics__ensure_tables' },
  );
}

async function flushEndpoints(): Promise<number> {
  const items = drainEndpoints();
  if (items.length === 0) return 0;
  for (const item of items) {
    await query(
      `INSERT INTO api_metrics (endpoint, domain_slug, serial_id, request_count, bytes_sent, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (endpoint, domain_slug, serial_id)
       DO UPDATE SET
         request_count = api_metrics.request_count + EXCLUDED.request_count,
         bytes_sent = api_metrics.bytes_sent + EXCLUDED.bytes_sent,
         updated_at = NOW()`,
      [item.endpoint, item.domain, item.serialId, item.requestCount, item.bytesSent],
      { name: 'metrics__upsert_endpoint' },
    );
  }
  return items.length;
}

async function flushVariables(): Promise<number> {
  const items = drainVariables();
  if (items.length === 0) return 0;
  for (const item of items) {
    await query(
      `INSERT INTO api_variable_metrics
         (nombre_dato, serial_id, request_count, bytes_sent, duration_ms_total, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (nombre_dato, serial_id)
       DO UPDATE SET
         request_count = api_variable_metrics.request_count + EXCLUDED.request_count,
         bytes_sent = api_variable_metrics.bytes_sent + EXCLUDED.bytes_sent,
         duration_ms_total = api_variable_metrics.duration_ms_total + EXCLUDED.duration_ms_total,
         updated_at = NOW()`,
      [item.nombreDato, item.serialId, item.requestCount, item.bytesSent, item.durationMsTotal],
      { name: 'metrics__upsert_variable' },
    );
  }
  return items.length;
}

export async function flushOnce(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const [eCount, vCount] = await Promise.all([flushEndpoints(), flushVariables()]);
    if (eCount + vCount > 0) {
      logger.debug({ endpoints: eCount, variables: vCount }, 'Metrics flushed');
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Metrics flush falló');
  } finally {
    flushing = false;
  }
}

export async function startMetricsFlusher(intervalMs = DEFAULT_INTERVAL_MS): Promise<void> {
  if (timer) return;
  try {
    await ensureTables();
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'No se pudieron crear tablas de métricas');
  }
  timer = setInterval(() => {
    void flushOnce();
  }, intervalMs);
  timer.unref?.();
  logger.info({ intervalMs }, 'Metrics flusher iniciado');
}

export async function stopMetricsFlusher(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const { endpoints, variables } = bufferSizes();
  if (endpoints + variables > 0) {
    await flushOnce();
  }
}
