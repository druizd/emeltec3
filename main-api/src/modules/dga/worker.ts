/**
 * Worker fill DGA (modelo redesign 2026-05-17).
 *
 * Lee slots vacio + valida + transiciona a pendiente|requires_review.
 * Itera pozos con `pozo_config.dga_activo=true` (incluye transport='off'/
 * 'shadow' — el envío es responsabilidad del submission worker).
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import {
  findLastValidTotalizador,
  findRecentDatoDgaReadings,
  listPozosDgaActivos,
  listVacioSlotsForSite,
  markPozoDgaLastRun,
  transitionSlotToPendiente,
  transitionSlotToRequiresReview,
  type PozoDgaConfigRow,
  type VacioSlotRow,
} from './repo';
import { validateSlot, FROZEN_WINDOW_DEFAULT_N } from './validation';
import {
  getDashboardBucketExact,
  getMappingsBySiteId,
  getPozoConfigBySiteId,
  getSiteById,
} from '../sites/repo';
import { mapHistoricalDashboardRow } from '../sites/service';
import type { PozoConfig, RegMap, Site } from '../sites/types';

const POLL_INTERVAL_MS = Number(process.env.DGA_WORKER_POLL_MS ?? 60_000);
const MAX_SLOTS_PER_POZO = Number(process.env.DGA_WORKER_MAX_SLOTS ?? 24);
const WORKER_ENABLED = String(process.env.ENABLE_DGA_WORKER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

interface SiteBundle {
  site: Site;
  pozoConfig: PozoConfig | null;
  mappings: RegMap[];
}

async function loadSiteBundle(siteId: string): Promise<SiteBundle | null> {
  const site = await getSiteById(siteId);
  if (!site) return null;
  const [pozoConfig, mappings] = await Promise.all([
    getPozoConfigBySiteId(siteId),
    getMappingsBySiteId(siteId),
  ]);
  return { site, pozoConfig, mappings };
}

async function fillSlot(
  pozoDga: PozoDgaConfigRow,
  bundle: SiteBundle,
  slot: VacioSlotRow,
): Promise<'pendiente' | 'requires_review' | 'no_data' | 'skipped'> {
  const idSerial = bundle.site.id_serial;
  if (!idSerial) {
    logger.warn({ site_id: pozoDga.sitio_id }, 'DGA fill: sitio sin id_serial');
    return 'skipped';
  }

  // Match exacto: bucket equipo_1min con timestamp = slot.ts. Si no existe,
  // dato aún no arribó (red intermitente, sensor offline) → slot queda vacio,
  // reintenta próximo ciclo. NO se usa lectura aproximada para preservar
  // consistencia dashboard ↔ DGA.
  const representative = await getDashboardBucketExact(idSerial, slot.ts);
  if (!representative) return 'no_data';

  const processed = mapHistoricalDashboardRow({
    row: representative,
    site: bundle.site,
    mappings: bundle.mappings,
    pozoConfig: bundle.pozoConfig,
  });

  const caudal = numericOrNull(processed.caudal.valor);
  const totalizadorRaw = numericOrNull(processed.totalizador.valor);
  const totalizador = totalizadorRaw == null ? null : Math.trunc(totalizadorRaw);
  const nivelFreatico = numericOrNull(processed.nivel_freatico.valor);

  const totalizadorMap = bundle.mappings.find((m) => m.rol_dashboard === 'totalizador');
  const totalizadorParams = (totalizadorMap?.parametros ?? {}) as Record<string, unknown>;

  let lastValidTotalizador: number | null = null;
  if (
    totalizador == null ||
    totalizador === 0 ||
    totalizadorParams.sensor_known_defective === true
  ) {
    lastValidTotalizador = await findLastValidTotalizador(pozoDga.sitio_id, slot.ts);
  }

  // Fetch de historial previo para reglas sensor_frozen y caudal_spike.
  // N = max(frozen_window_n configurado, 1). Una sola query cubre ambas reglas
  // (spike solo usa priorReadings[0], frozen usa hasta n-1).
  const configN = Number(totalizadorParams.frozen_window_n);
  const historyN = Math.max(
    Number.isFinite(configN) && configN >= 2 ? Math.trunc(configN) : FROZEN_WINDOW_DEFAULT_N,
    1,
  );
  const priorReadings = await findRecentDatoDgaReadings(pozoDga.sitio_id, slot.ts, historyN);

  const validation = validateSlot(
    { caudal, totalizador, nivelFreatico },
    { pozoDga, totalizadorParams, lastValidTotalizador, priorReadings },
  );

  if (validation.ok) {
    // ok con warnings = anomalías informativas (sensor marcado defectuoso):
    // el slot se envía igual y las incidencias quedan persistidas en el slot.
    const updated = await transitionSlotToPendiente({
      site_id: pozoDga.sitio_id,
      ts: slot.ts,
      caudal_instantaneo: caudal,
      flujo_acumulado: totalizador,
      nivel_freatico: nivelFreatico,
      validation_warnings: validation.warnings,
    });
    if (updated && validation.warnings.length > 0) {
      logger.warn(
        { site_id: pozoDga.sitio_id, ts: slot.ts, codes: validation.warnings.map((w) => w.code) },
        'DGA fill: slot enviable con incidencias registradas (sensor defectuoso)',
      );
    }
    return updated ? 'pendiente' : 'skipped';
  }

  const updated = await transitionSlotToRequiresReview({
    site_id: pozoDga.sitio_id,
    ts: slot.ts,
    caudal_instantaneo: caudal,
    flujo_acumulado: totalizador,
    nivel_freatico: nivelFreatico,
    validation_warnings: validation.warnings,
    fail_reason: validation.failReason ?? 'unknown',
  });
  return updated ? 'requires_review' : 'skipped';
}

async function processPozo(pozoDga: PozoDgaConfigRow): Promise<void> {
  const bundle = await loadSiteBundle(pozoDga.sitio_id);
  if (!bundle) {
    logger.warn({ site_id: pozoDga.sitio_id }, 'DGA fill: sitio no encontrado');
    return;
  }

  const slots = await listVacioSlotsForSite(pozoDga.sitio_id, MAX_SLOTS_PER_POZO);
  if (slots.length === 0) return;

  let pendiente = 0;
  let requiresReview = 0;
  let noData = 0;

  for (const slot of slots) {
    try {
      const outcome = await fillSlot(pozoDga, bundle, slot);
      if (outcome === 'pendiente') pendiente++;
      else if (outcome === 'requires_review') requiresReview++;
      else if (outcome === 'no_data') noData++;
    } catch (err) {
      logger.error(
        { site_id: pozoDga.sitio_id, ts: slot.ts, err: (err as Error).message },
        'DGA fill: fallo en slot',
      );
    }
  }

  if (pendiente > 0 || requiresReview > 0) {
    await markPozoDgaLastRun(pozoDga.sitio_id, new Date().toISOString());
    logger.info(
      {
        site_id: pozoDga.sitio_id,
        pendiente,
        requires_review: requiresReview,
        no_data: noData,
        slots_total: slots.length,
      },
      'DGA fill: pozo procesado',
    );
  }
}

async function runCycle(): Promise<void> {
  beat('dgaWorker');
  try {
    const pozos = await listPozosDgaActivos();
    for (const pozo of pozos) {
      await processPozo(pozo);
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'DGA fill: ciclo falló');
  }
}

export function startDgaWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('DGA worker deshabilitado (ENABLE_DGA_WORKER=false)');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'DGA fill worker iniciado');
  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopDgaWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('DGA fill worker detenido');
}
