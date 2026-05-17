/**
 * Worker pre-seed DGA.
 *
 * Crea los "slots" del mes en `dato_dga` con estatus='vacio' para cada
 * informante activo. El worker de fill (worker.ts) los rellenará luego con
 * telemetría real; el de submission los enviará a SNIA cuando estén listos.
 *
 * Filosofía (Manual Técnico DGA 1/2025):
 *   - Pre-seed = calendario explícito de envíos esperados del mes.
 *   - Un slot ausente NO significa "no hay obligación de reportar". Por eso
 *     materializamos todos los slots por adelantado: la ausencia de fila
 *     equivale a un bug del seed, no a una decisión legítima.
 *   - El seed respeta `fecha_inicio + hora_inicio` del informante: no crea
 *     slots anteriores a esa fecha legal.
 *
 * Idempotente: PRIMARY KEY (id_dgauser, ts) + ON CONFLICT DO NOTHING. Se
 * puede correr múltiples veces por mes sin duplicar.
 *
 * Cadencia:
 *   - Bootstrap inmediato al arrancar el proceso (cubre caso de mes nuevo
 *     que arrancó mientras el proceso estaba caído).
 *   - setInterval cada DGA_PRESEED_POLL_MS (default 6h). Suficiente para
 *     que el día 1 de cada mes los slots aparezcan dentro de las primeras
 *     6h del mes nuevo.
 *
 * Costo: query única por informante usando generate_series en Postgres
 * (no hace round-trip por slot). Para periodicidad horaria, ~720 filas/mes
 * por informante.
 *
 * En cluster con réplicas, encender SOLO en una vía ENABLE_DGA_PRESEED_WORKER=true.
 */
import { logger } from '../../config/logger';
import { query } from '../../config/dbHelpers';
import { getPozoConfigBySiteId, listPozosActivos } from '../sites/repo';
import { listDgaUsersBySite, type DgaUserRow } from './repo';

const POLL_INTERVAL_MS = Number(process.env.DGA_PRESEED_POLL_MS ?? 6 * 60 * 60 * 1000);
const WORKER_ENABLED =
  String(process.env.ENABLE_DGA_PRESEED_WORKER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Mapea la periodicidad del informante a un INTERVAL Postgres usado por
 * generate_series. Valores fijos para evitar inyección (no aceptamos string
 * arbitrario del usuario).
 */
function periodicidadToInterval(p: DgaUserRow['periodicidad']): string {
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
  id_dgauser: number;
  inserted: number;
}

/**
 * Genera los slots del mes actual para un informante de un pozo.
 *
 * Algoritmo (todo en Postgres en una query):
 *   1. Calcula límites del mes actual en hora local Chile (Etc/GMT+4).
 *   2. Calcula anchor = max(monthStart, fecha_inicio+hora_inicio del usuario).
 *      Garantiza que no se crean slots anteriores al compromiso legal.
 *   3. generate_series desde anchor hasta fin de mes, paso=periodicidad.
 *   4. Convierte cada slot local → TIMESTAMPTZ UTC y lo inserta.
 *   5. ON CONFLICT DO NOTHING omite slots ya existentes (idempotencia).
 *
 * Nota timezone: Postgres usa "Etc/GMT+4" para representar UTC-4 (signo
 * invertido por POSIX, no es un typo). Chile continental no tiene DST en
 * esta config.
 */
async function runPreseedForUser(user: DgaUserRow, obra: string): Promise<PreseedResult> {
  const idDgaUser = Number(user.id_dgauser);
  const stepInterval = periodicidadToInterval(user.periodicidad);

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
      INSERT INTO dato_dga (id_dgauser, obra, ts, estatus)
      SELECT
        $1::bigint,
        $4::text,
        slot AT TIME ZONE 'Etc/GMT+4',
        'vacio'
      FROM anchor,
      LATERAL generate_series(
        first_slot_local,
        next_month_local - interval '1 second',
        $5::interval
      ) AS slot
      ON CONFLICT (id_dgauser, ts) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS inserted FROM ins
    `,
    [idDgaUser, user.fecha_inicio, user.hora_inicio, obra, stepInterval],
    { name: 'dga__preseed_month' },
  );

  return { id_dgauser: idDgaUser, inserted: res.rows[0]?.inserted ?? 0 };
}

/**
 * Ejecuta el seed para todos los pozos activos del sistema (tipo_sitio='pozo',
 * sitio.activo=true). Para cada pozo busca sus informantes DGA y seedea slots
 * por cada uno.
 *
 * Iterar por pozos (no por dga_user) garantiza que:
 *   - Pozos sin informante DGA configurado quedan surfaceados como warning
 *     (gap de config visible, no silencio).
 *   - Pozos físicamente decomisionados (sitio.activo=false) quedan fuera.
 *   - Se procesa el universo completo de pozos activos, no solo subconjunto
 *     que happen to tener informante.
 *
 * Incluye informantes con dga_user.activo=false: si se reactiva a mitad de
 * mes, los slots ya existen y fill puede empezar. El gate real de envío
 * lo hacen `dga_user.activo` y `dga_user.transport` en fill/submission.
 *
 * Falla en silencio por pozo/informante para no bloquear el resto.
 */
export async function runPreseedCycle(): Promise<void> {
  try {
    const pozos = await listPozosActivos();
    if (pozos.length === 0) {
      logger.debug('DGA preseed: sin pozos activos');
      return;
    }

    let totalInserted = 0;
    let totalInformantes = 0;
    let pozosSinInformante = 0;

    for (const pozo of pozos) {
      try {
        const users = await listDgaUsersBySite(pozo.id);
        if (users.length === 0) {
          pozosSinInformante++;
          logger.warn(
            { site_id: pozo.id, descripcion: pozo.descripcion },
            'DGA preseed: pozo sin informante DGA configurado',
          );
          continue;
        }

        // Obra denormalizada en dato_dga: fuente única por pozo, vale para
        // todos sus informantes. Se calcula una vez por pozo.
        const pozoConfig = await getPozoConfigBySiteId(pozo.id);
        const obra = pozoConfig?.obra_dga?.trim() || pozo.descripcion;

        for (const user of users) {
          totalInformantes++;
          try {
            const result = await runPreseedForUser(user, obra);
            if (result.inserted > 0) {
              totalInserted += result.inserted;
              logger.info(
                {
                  site_id: pozo.id,
                  id_dgauser: result.id_dgauser,
                  slots: result.inserted,
                },
                'DGA preseed: slots creados',
              );
            }
          } catch (err) {
            logger.error(
              {
                site_id: pozo.id,
                id_dgauser: user.id_dgauser,
                err: (err as Error).message,
              },
              'DGA preseed: fallo por informante',
            );
          }
        }
      } catch (err) {
        logger.error(
          { site_id: pozo.id, err: (err as Error).message },
          'DGA preseed: fallo por pozo',
        );
      }
    }

    if (totalInserted > 0 || pozosSinInformante > 0) {
      logger.info(
        {
          pozos: pozos.length,
          informantes: totalInformantes,
          pozosSinInformante,
          totalInserted,
        },
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
  // Bootstrap inmediato: cubre el caso de proceso reiniciado tras inicio
  // de mes nuevo (sin esperar al primer tick del setInterval).
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
