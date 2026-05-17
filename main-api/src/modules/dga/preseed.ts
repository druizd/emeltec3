/**
 * Worker pre-seed DGA (modelo redesign 2026-05-17).
 *
 * Crea slots vacio del mes en `dato_dga` para cada pozo con `dga_activo=true`
 * y config completa (`dga_periodicidad`, `dga_fecha_inicio`, `dga_hora_inicio`).
 *
 * Pozos con `dga_activo=false` o config incompleta NO se seedean. Cuando admin
 * activa el switch (PATCH pozo-config), el próximo ciclo del worker crea los
 * slots automáticamente.
 *
 * Idempotente vía PK (site_id, ts) + ON CONFLICT DO NOTHING.
 *
 * Cadencia: bootstrap + cada DGA_PRESEED_POLL_MS (default 6h).
 */
import { logger } from '../../config/logger';
import { query } from '../../config/dbHelpers';
import { getPozoConfigBySiteId } from '../sites/repo';
import { listPozosDgaActivos, type PozoDgaConfigRow } from './repo';
import type { Periodicidad } from './schema';

const POLL_INTERVAL_MS = Number(process.env.DGA_PRESEED_POLL_MS ?? 6 * 60 * 60 * 1000);
const WORKER_ENABLED =
  String(process.env.ENABLE_DGA_PRESEED_WORKER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

function periodicidadToInterval(p: Periodicidad): string {
  switch (p) {
    case 'hora':
      return '1 hour';
    case 'dia':
      return '1 day';
    case 'semana':
      return '7 days';
    case 'mes':
      return '1 month';
    default:
      return '1 day';
  }
}

interface PreseedResult {
  site_id: string;
  inserted: number;
}

async function runPreseedForPozo(pozo: PozoDgaConfigRow): Promise<PreseedResult | null> {
  if (!pozo.dga_periodicidad || !pozo.dga_fecha_inicio || !pozo.dga_hora_inicio) {
    logger.warn(
      { site_id: pozo.sitio_id },
      'DGA preseed: pozo activo pero sin periodicidad/fecha/hora inicio — saltado',
    );
    return null;
  }

  const sitePozoConfig = await getPozoConfigBySiteId(pozo.sitio_id);
  const obra = (pozo.obra_dga ?? '').trim() || sitePozoConfig?.slug || pozo.sitio_id;

  const stepInterval = periodicidadToInterval(pozo.dga_periodicidad);

  const res = await query<{ inserted: number }>(
    `
    WITH bounds AS (
      SELECT
        date_trunc('month', now() AT TIME ZONE 'Etc/GMT+4')                       AS month_start_local,
        date_trunc('month', now() AT TIME ZONE 'Etc/GMT+4') + interval '1 month'  AS next_month_local,
        ($2::date + $3::time)                                                     AS user_start_local
    ),
    anchor AS (
      SELECT
        GREATEST(month_start_local, user_start_local) AS first_slot_local,
        next_month_local
      FROM bounds
    ),
    ins AS (
      INSERT INTO dato_dga (site_id, obra, ts, estatus)
      SELECT
        $1::text,
        $4::text,
        slot AT TIME ZONE 'Etc/GMT+4',
        'vacio'
      FROM anchor,
      LATERAL generate_series(
        first_slot_local,
        next_month_local - interval '1 second',
        $5::interval
      ) AS slot
      ON CONFLICT (site_id, ts) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS inserted FROM ins
    `,
    [pozo.sitio_id, pozo.dga_fecha_inicio, pozo.dga_hora_inicio, obra, stepInterval],
    { name: 'dga__preseed_month' },
  );

  return { site_id: pozo.sitio_id, inserted: res.rows[0]?.inserted ?? 0 };
}

export async function runPreseedCycle(): Promise<void> {
  try {
    const pozos = await listPozosDgaActivos();
    if (pozos.length === 0) {
      logger.debug('DGA preseed: sin pozos con dga_activo=true');
      return;
    }

    let totalInserted = 0;
    let pozosOk = 0;
    let pozosSkipped = 0;

    for (const pozo of pozos) {
      try {
        const result = await runPreseedForPozo(pozo);
        if (!result) {
          pozosSkipped++;
          continue;
        }
        pozosOk++;
        if (result.inserted > 0) {
          totalInserted += result.inserted;
          logger.info(
            { site_id: result.site_id, slots: result.inserted },
            'DGA preseed: slots creados',
          );
        }
      } catch (err) {
        logger.error(
          { site_id: pozo.sitio_id, err: (err as Error).message },
          'DGA preseed: fallo por pozo',
        );
      }
    }

    if (totalInserted > 0 || pozosSkipped > 0) {
      logger.info(
        { pozosActivos: pozos.length, pozosOk, pozosSkipped, totalInserted },
        'DGA preseed: ciclo completo',
      );
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'DGA preseed: ciclo falló');
  }
}

export function startDgaPreseedWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('DGA preseed worker deshabilitado (ENABLE_DGA_PRESEED_WORKER=false)');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'DGA preseed worker iniciado');
  void runPreseedCycle();
  intervalHandle = setInterval(() => {
    void runPreseedCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopDgaPreseedWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('DGA preseed worker detenido');
}
