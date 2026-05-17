/**
 * Worker fill DGA (modelo redesign 2026-05-17).
 *
 * Lee slots vacio + valida + transiciona a pendiente|requires_review.
 * Itera pozos con `pozo_config.dga_activo=true` (incluye transport='off'/
 * 'shadow' — el envío es responsabilidad del submission worker).
 */
import { logger } from '../../config/logger';
import {
  findLastValidTotalizador,
  listPozosDgaActivos,
  listVacioSlotsForSite,
  markPozoDgaLastRun,
  transitionSlotToPendiente,
  transitionSlotToRequiresReview,
  type PozoDgaConfigRow,
  type VacioSlotRow,
} from './repo';
import { validateSlot } from './validation';
import {
  getDashboardHistoryRange,
  getMappingsBySiteId,
  getPozoConfigBySiteId,
  getSiteById,
} from '../sites/repo';
import { mapHistoricalDashboardRow } from '../sites/service';
import type { HistoryEquipoRow, PozoConfig, RegMap, Site } from '../sites/types';

const POLL_INTERVAL_MS = Number(process.env.DGA_WORKER_POLL_MS ?? 60_000);
const MAX_SLOTS_PER_POZO = Number(process.env.DGA_WORKER_MAX_SLOTS ?? 24);
const WORKER_ENABLED = String(process.env.ENABLE_DGA_WORKER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

function periodicidadWindowMs(periodicidad: PozoDgaConfigRow['dga_periodicidad']): number {
  switch (periodicidad) {
    case 'hora':
      return 60 * 60 * 1000;
    case 'dia':
      return 24 * 60 * 60 * 1000;
    case 'semana':
      return 7 * 24 * 60 * 60 * 1000;
    case 'mes':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

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

  const slotTs = new Date(slot.ts);
  const windowMs = periodicidadWindowMs(pozoDga.dga_periodicidad);
  const windowStart = new Date(slotTs.getTime() - windowMs);

  const rawRows: HistoryEquipoRow[] = await getDashboardHistoryRange(
    idSerial,
    windowStart.toISOString(),
    slotTs.toISOString(),
  );
  const representative = rawRows[0];
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

  const validation = validateSlot(
    { caudal, totalizador, nivelFreatico },
    { pozoDga, totalizadorParams, lastValidTotalizador },
  );

  if (validation.ok) {
    const updated = await transitionSlotToPendiente({
      site_id: pozoDga.sitio_id,
      ts: slot.ts,
      caudal_instantaneo: caudal,
      flujo_acumulado: totalizador,
      nivel_freatico: nivelFreatico,
    });
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
