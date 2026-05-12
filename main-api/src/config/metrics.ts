/**
 * Métricas Prometheus (prom-client).
 * - http_request_duration_seconds: histograma por ruta/método/status
 * - db_query_duration_seconds: histograma de queries (etiqueta `name`)
 * - cache_operations_total: contador get/set/hit/miss
 */
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'main_api_' });

export const httpRequestDuration = new Histogram({
  name: 'main_api_http_request_duration_seconds',
  help: 'Duración de requests HTTP',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const dbQueryDuration = new Histogram({
  name: 'main_api_db_query_duration_seconds',
  help: 'Duración de queries pg',
  labelNames: ['name', 'status'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

export const cacheOps = new Counter({
  name: 'main_api_cache_operations_total',
  help: 'Operaciones de caché',
  labelNames: ['op', 'result'] as const,
  registers: [registry],
});
