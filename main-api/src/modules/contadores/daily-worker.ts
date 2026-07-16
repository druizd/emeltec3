/**
 * Worker de materialización de contadores daily + jornada.
 *
 * Cada N segundos (default 3600s = 1h):
 *   1) Lista variables tipo contador activas en todos los sitios.
 *   2) Para cada una, recomputa los últimos DIAS_REFRESH días.
 *   3) Para jornada, solo materializa cuando hay configuración de
 *      jornada en la variable (via siteOperacionConfig, inicio/fin).
 *   4) Upsert sobre site_contador_diario y site_contador_jornada.
 *
 * Kill switch: ENABLE_CONTADORES_DAILY_WORKER (default: false).
 * No activo por defecto para no interferir con el worker mensual existente
 * ni con despliegues que aún no tienen la migration 009 ejecutada.
 *
 * Patrón idéntico al worker mensual (src/modules/contadores/worker.ts).
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { getMappingsBySiteId, getSiteById, listCounterVariables } from './repo';
import {
  computeDailyDeltasForVariable,
  computeJornadasForVariable,
  getDayRangeChile,
  lastNDays,
} from './service';
import { getPozoConfigBySiteId } from '../sites/repo';
import { upsertContadorDiario, upsertContadorJornada } from './daily-repo';
import { findSiteOperacionConfig } from '../siteOperacionConfig/repo';

const POLL_INTERVAL_MS = Number(process.env.CONTADORES_DAILY_WORKER_POLL_MS ?? 60 * 60 * 1000);
const WORKER_ENABLED =
  String(process.env.ENABLE_CONTADORES_DAILY_WORKER ?? 'false').toLowerCase() !== 'false';
// Días a recomputar en cada ciclo. 2 = hoy + ayer (cubre late data del dia anterior).
const DIAS_REFRESH = Number(process.env.CONTADORES_DAILY_WORKER_DIAS ?? 2);

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

export async function runCycle(): Promise<void> {
  beat('contadores_daily');
  if (running) return;
  running = true;
  const startedAt = Date.now();
  try {
    const counters = await listCounterVariables();
    const days = lastNDays(DIAS_REFRESH);

    const mappingsCache = new Map<string, Awaited<ReturnType<typeof getMappingsBySiteId>>>();
    const pozoCache = new Map<string, Awaited<ReturnType<typeof getPozoConfigBySiteId>>>();
    const opConfigCache = new Map<string, Awaited<ReturnType<typeof findSiteOperacionConfig>>>();

    let upserts = 0;

    for (const counter of counters) {
      try {
        if (!counter.id_serial) continue;

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

        // ── Diario ───────────────────────────────────────────────────────────
        if (days.length > 0) {
          const firstDay = days[0]!;
          const lastDay = days[days.length - 1]!;
          const start = getDayRangeChile(firstDay).start;
          const end = getDayRangeChile(lastDay).end;

          const deltasByDay = await computeDailyDeltasForVariable({
            idSerial: counter.id_serial,
            mapping,
            pozoConfig,
            start,
            end,
          });

          for (const day of days) {
            const { diaIso } = getDayRangeChile(day);
            const r = deltasByDay.get(diaIso);
            if (!r) {
              // Sin datos para ese día — upsert con muestras=0 para indicar
              // que fue procesado (evita fallos de lookup posteriores).
              await upsertContadorDiario({
                sitio_id: counter.sitio_id,
                variable_id: counter.variable_id,
                rol: counter.rol,
                dia: diaIso,
                valor_inicio: null,
                valor_fin: null,
                delta: null,
                unidad: counter.unidad,
                muestras: 0,
                resets_detectados: 0,
                ultimo_dato: null,
              });
            } else {
              await upsertContadorDiario({
                sitio_id: counter.sitio_id,
                variable_id: counter.variable_id,
                rol: counter.rol,
                dia: diaIso,
                valor_inicio: r.valor_inicio,
                valor_fin: r.valor_fin,
                delta: r.delta,
                unidad: counter.unidad,
                muestras: r.muestras,
                resets_detectados: r.resets_detectados,
                ultimo_dato: r.ultimo_dato,
              });
            }
            upserts++;
          }
        }

        // ── Jornada ──────────────────────────────────────────────────────────
        // Lee la config de jornada del sitio para saber inicio/fin.
        // Si no hay config de jornada, omite la materialización.
        if (!opConfigCache.has(counter.sitio_id)) {
          opConfigCache.set(counter.sitio_id, await findSiteOperacionConfig(counter.sitio_id));
        }
        const opConfig = opConfigCache.get(counter.sitio_id);
        if (!opConfig?.jornada_inicio || !opConfig?.jornada_fin) continue;

        const inicio = opConfig.jornada_inicio;
        const fin = opConfig.jornada_fin;

        const jornadaByDay = await computeJornadasForVariable({
          idSerial: counter.id_serial,
          mapping,
          pozoConfig,
          days,
          inicio,
          fin,
        });

        for (const day of days) {
          const { diaIso } = getDayRangeChile(day);
          const r = jornadaByDay.get(diaIso);
          if (!r) {
            await upsertContadorJornada({
              sitio_id: counter.sitio_id,
              variable_id: counter.variable_id,
              rol: counter.rol,
              dia: diaIso,
              inicio,
              fin,
              valor_inicio: null,
              valor_fin: null,
              delta: null,
              unidad: counter.unidad,
              muestras: 0,
              resets_detectados: 0,
              ultimo_dato: null,
            });
          } else {
            await upsertContadorJornada({
              sitio_id: counter.sitio_id,
              variable_id: counter.variable_id,
              rol: counter.rol,
              dia: diaIso,
              inicio,
              fin,
              valor_inicio: r.valor_inicio,
              valor_fin: r.valor_fin,
              delta: r.delta,
              unidad: counter.unidad,
              muestras: r.muestras,
              resets_detectados: r.resets_detectados,
              ultimo_dato: r.ultimo_dato,
            });
          }
          upserts++;
        }
      } catch (err) {
        logger.error(
          {
            sitio_id: counter.sitio_id,
            variable_id: counter.variable_id,
            err: (err as Error).message,
          },
          'contadores-daily worker: fallo en variable',
        );
      }
    }

    logger.info(
      {
        counters: counters.length,
        upserts,
        diasRefresh: DIAS_REFRESH,
        durationMs: Date.now() - startedAt,
      },
      'contadores-daily worker: ciclo completado',
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'contadores-daily worker: ciclo fallo');
  } finally {
    running = false;
  }
}

export function startContadoresDailyWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info(
      'contadores-daily worker deshabilitado (ENABLE_CONTADORES_DAILY_WORKER=false)',
    );
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'contadores-daily worker iniciado');
  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopContadoresDailyWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('contadores-daily worker detenido');
}
