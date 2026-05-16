/**
 * Worker de contadores.
 *
 * Cada N segundos (default 3600s = 1h):
 *   1) Lista variables tipo contador activas en todos los sitios.
 *   2) Para cada una, recomputa mes_actual y mes_anterior (para capturar late
 *      data) llamando a recomputeMonthsForVariable.
 *   3) Upsert sobre site_contador_mensual.
 *
 * No procesa meses historicos: el backfill manual los hace
 * (scripts/backfill-contadores-mensuales.js).
 *
 * En cluster con replicas, activar SOLO en una via
 * ENABLE_CONTADORES_WORKER=true.
 */
import { logger } from '../../config/logger';
import { getMappingsBySiteId, getSiteById, listCounterVariables } from './repo';
import { lastNMonths, recomputeMonthsForVariable } from './service';
import { getPozoConfigBySiteId } from '../sites/repo';

const POLL_INTERVAL_MS = Number(process.env.CONTADORES_WORKER_POLL_MS ?? 60 * 60 * 1000);
const WORKER_ENABLED =
  String(process.env.ENABLE_CONTADORES_WORKER ?? 'true').toLowerCase() !== 'false';
const MESES_REFRESH = Number(process.env.CONTADORES_WORKER_MESES ?? 2);

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

async function runCycle(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const counters = await listCounterVariables();
    const meses = lastNMonths(MESES_REFRESH);

    // Cache para mappings/pozoConfig por sitio: varias variables del mismo sitio.
    const mappingsCache = new Map<string, Awaited<ReturnType<typeof getMappingsBySiteId>>>();
    const pozoCache = new Map<string, Awaited<ReturnType<typeof getPozoConfigBySiteId>>>();

    let upserts = 0;
    for (const counter of counters) {
      try {
        if (!mappingsCache.has(counter.sitio_id)) {
          mappingsCache.set(counter.sitio_id, await getMappingsBySiteId(counter.sitio_id));
        }
        if (!pozoCache.has(counter.sitio_id)) {
          const site = await getSiteById(counter.sitio_id);
          pozoCache.set(
            counter.sitio_id,
            site?.tipo_sitio === 'pozo' ? await getPozoConfigBySiteId(counter.sitio_id) : null,
          );
        }
        const mapping = mappingsCache
          .get(counter.sitio_id)!
          .find((m) => m.id === counter.variable_id);
        if (!mapping) continue;
        const pozoConfig = pozoCache.get(counter.sitio_id) ?? null;
        const n = await recomputeMonthsForVariable({
          counter,
          mapping,
          pozoConfig,
          meses,
        });
        upserts += n;
      } catch (err) {
        logger.error(
          {
            sitio_id: counter.sitio_id,
            variable_id: counter.variable_id,
            err: (err as Error).message,
          },
          'contadores worker: fallo en variable',
        );
      }
    }
    logger.info(
      {
        counters: counters.length,
        upserts,
        durationMs: Date.now() - startedAt,
      },
      'contadores worker: ciclo completado',
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'contadores worker: ciclo fallo');
  } finally {
    running = false;
  }
}

export function startContadoresWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('contadores worker deshabilitado (ENABLE_CONTADORES_WORKER=false)');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'contadores worker iniciado');
  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopContadoresWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('contadores worker detenido');
}
