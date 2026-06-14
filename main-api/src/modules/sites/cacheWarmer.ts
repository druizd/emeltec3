/**
 * Cache warmer para dashboard-history.
 * Recorre los sitios activos cada INTERVAL_MS y llama getDashboardHistory
 * para cada uno — el resultado queda cacheado en Redis antes de que expire.
 * Evita que usuarios vean la query lenta (10-20s) en el primer acceso.
 *
 * Activación: env ENABLE_CACHE_WARMER_WORKER=true
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { query } from '../../config/dbHelpers';
import { getDashboardHistory } from './repo';

const INTERVAL_MS = 50_000;
const HISTORY_LIMITS = [500, 2200];
const WORKER_ENABLED =
  String(process.env.ENABLE_CACHE_WARMER_WORKER ?? 'true').toLowerCase() === 'true';

async function getActiveSiteSerials(): Promise<string[]> {
  const result = await query<{ id_serial: string }>(
    `SELECT id_serial FROM sitio WHERE activo = true ORDER BY id_serial`,
    [],
    { label: 'cache_warmer__active_sites' },
  );
  return result.rows.map((r) => r.id_serial);
}

async function warmAll(): Promise<void> {
  beat('cacheWarmer');
  const serials = await getActiveSiteSerials();
  for (const serial of serials) {
    for (const limit of HISTORY_LIMITS) {
      try {
        await getDashboardHistory(serial, limit, { forceRefresh: true });
      } catch (err) {
        logger.warn({ serial, limit, err }, 'cache_warmer: error calentando sitio');
      }
    }
  }
  logger.debug({ count: serials.length }, 'cache_warmer: ciclo completado');
}

export function startCacheWarmerWorker(): void {
  if (!WORKER_ENABLED) return;

  // Primera pasada al arranque (sin bloquear el servidor).
  void warmAll();

  setInterval(() => void warmAll(), INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, 'cache_warmer: worker iniciado');
}
