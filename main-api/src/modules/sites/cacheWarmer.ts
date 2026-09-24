/**
 * Cache warmer para dashboard-history.
 * Recorre los sitios activos y llama getDashboardHistory para cada uno — el
 * resultado queda cacheado en Redis antes de que expire. Evita que usuarios
 * vean la query lenta (10-20s) en el primer acceso.
 *
 * Guardia de reentrada y encadenado (incidente 24-09-2026): con ~40 sitios
 * activos x 2 límites por barrido, cada pasada tarda 3-6 minutos en
 * producción. Con setInterval(INTERVAL_MS) se disparaba una pasada nueva
 * cada 50s sin preguntar si la anterior había terminado; en pocos minutos
 * había 4-6 barridos simultáneos peleando por el pool de conexiones (20) y
 * la CPU (2 vCPU), lo que hacía cada consulta más lenta y acumulaba aún más
 * barridos superpuestos — hasta tumbar /api/v2/companies/tree por
 * statement timeout. Ahora un flag de módulo (isWarming) impide que dos
 * barridos corran a la vez, y el siguiente se programa con setTimeout recién
 * cuando el anterior TERMINA (éxito o error), nunca con un reloj fijo.
 * Además se agrega una pausa entre sitio y sitio para que las consultas de
 * los usuarios consigan turno en vez de competir contra un bucle apretado.
 *
 * Activación: env ENABLE_CACHE_WARMER_WORKER=true
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { query } from '../../config/dbHelpers';
import { getDashboardHistory } from './repo';

const INTERVAL_MS = 50_000;
const HISTORY_LIMITS = [500, 2200];
const SITE_PAUSE_MS = 250;
const WORKER_ENABLED =
  String(process.env.ENABLE_CACHE_WARMER_WORKER ?? 'true').toLowerCase() === 'true';

// Guardia de reentrada: true mientras un barrido está en curso.
let isWarming = false;
// Handle del próximo barrido encadenado, para poder cancelarlo (tests, shutdown).
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

async function getActiveSiteSerials(): Promise<string[]> {
  const result = await query<{ id_serial: string }>(
    `SELECT id_serial FROM sitio WHERE activo = true ORDER BY id_serial`,
    [],
    { label: 'cache_warmer__active_sites' },
  );
  return result.rows.map((r) => r.id_serial);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function warmAll(): Promise<void> {
  if (isWarming) {
    logger.warn('cache_warmer: se omite el barrido, el anterior sigue en curso');
    return;
  }
  isWarming = true;
  const startedAt = Date.now();
  let failures = 0;
  try {
    beat('cacheWarmer');
    const serials = await getActiveSiteSerials();
    for (const [i, serial] of serials.entries()) {
      for (const limit of HISTORY_LIMITS) {
        try {
          await getDashboardHistory(serial, limit, { forceRefresh: true });
        } catch (err) {
          failures += 1;
          logger.warn({ serial, limit, err }, 'cache_warmer: error calentando sitio');
        }
      }
      // Sin pausa después del último sitio: no hay nada más por lo que esperar.
      if (i < serials.length - 1) {
        await sleep(SITE_PAUSE_MS);
      }
    }
    const durationMs = Date.now() - startedAt;
    const summary = { count: serials.length, durationMs, failures };
    if (durationMs > INTERVAL_MS) {
      logger.warn(
        summary,
        'cache_warmer: el barrido tardó más que su propio intervalo (INTERVAL_MS); revisar solapamiento',
      );
    } else {
      logger.debug(summary, 'cache_warmer: ciclo completado');
    }
  } finally {
    // Se libera pase lo que pase (éxito o excepción) para que el próximo
    // barrido encadenado no quede bloqueado por este.
    isWarming = false;
  }
}

function runCycle(): void {
  warmAll()
    .catch((err) => {
      logger.error({ err }, 'cache_warmer: fallo no controlado en el barrido');
    })
    .finally(() => {
      // La cadena sigue viva aunque este barrido haya fallado.
      pendingTimer = setTimeout(runCycle, INTERVAL_MS);
    });
}

export function startCacheWarmerWorker(): void {
  if (!WORKER_ENABLED) return;

  // Primera pasada al arranque (sin bloquear el servidor); al terminar
  // encadena la siguiente.
  runCycle();

  logger.info({ intervalMs: INTERVAL_MS }, 'cache_warmer: worker iniciado');
}

/** Limpia el timer encadenado pendiente. Necesario para no dejar timers colgando en tests. */
export function stopCacheWarmerWorker(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}
