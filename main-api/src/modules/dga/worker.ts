/**
 * Worker fill DGA.
 *
 * Modelo: pull-based sobre slots pre-seedeados.
 *   1. Pre-seed (preseed.ts) materializa slots del mes con estatus='vacio'.
 *   2. Fill (este worker) escanea slots 'vacio' vencidos, lee telemetría
 *      cercana, aplica transformaciones, valida y transiciona a 'pendiente'
 *      o 'requires_review'.
 *   3. Submission (worker separado) envía 'pendiente' a SNIA.
 *
 * Diferencias con la versión anterior (pre-2026-05-16):
 *   - No usa last_run_at como cursor — los slots son la verdad.
 *   - No hace INSERT — solo UPDATE de slots ya creados por pre-seed.
 *   - Aplica validación pre-envío (caudal_max_lps, sensor defectuoso, etc.).
 *   - Respeta dga_user.activo y dga_user.transport para el gating.
 *
 * Procesa informantes con activo=true. transport='off' también se procesa
 * (rellena slots como en shadow) — el gate de envío vive en submission, no
 * acá. Esto permite tener datos listos para comparar contra legacy antes
 * de flipear a 'rest'.
 *
 * Catch-up: hasta MAX_SLOTS_PER_USER por ciclo para evitar bloquear el
 * event loop si un informante tiene backlog masivo.
 *
 * En cluster con réplicas, encender SOLO en una vía ENABLE_DGA_WORKER=true.
 */
import { logger } from '../../config/logger';
import {
  findDgaUserById,
  findLastValidTotalizador,
  listActiveDgaUsers,
  listVacioSlotsForUser,
  transitionSlotToPendiente,
  transitionSlotToRequiresReview,
  type DgaUserRow,
  type VacioSlotRow,
} from './repo';
import { validateSlot } from './validation';
import { getDashboardHistoryRange, getMappingsBySiteId, getPozoConfigBySiteId, getSiteById } from '../sites/repo';
import { mapHistoricalDashboardRow } from '../sites/service';
import type { HistoryEquipoRow, PozoConfig, RegMap, Site } from '../sites/types';

const POLL_INTERVAL_MS = Number(process.env.DGA_WORKER_POLL_MS ?? 60_000);
const MAX_SLOTS_PER_USER = Number(process.env.DGA_WORKER_MAX_SLOTS ?? 24);
const WORKER_ENABLED = String(process.env.ENABLE_DGA_WORKER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Ventana de telemetría a consultar para un slot, según periodicidad del
 * informante. La lectura "representativa" del slot = la más reciente dentro
 * de [ts - periodicidad, ts]. Para horaria = última hora; para diaria =
 * últimas 24h; etc.
 */
function periodicidadWindowMs(periodicidad: DgaUserRow['periodicidad']): number {
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

/**
 * Procesa un slot: lee telemetría en la ventana previa al ts del slot,
 * transforma, valida y actualiza el slot. Devuelve el nuevo estado.
 *
 * Si la telemetría no existe en la ventana, deja el slot en 'vacio'. El
 * próximo ciclo lo reintentará. La alerta dga_atrasado (24/48/72h) se
 * dispara por separado si lleva mucho tiempo sin rellenarse.
 */
async function fillSlot(
  user: DgaUserRow,
  bundle: SiteBundle,
  slot: VacioSlotRow,
): Promise<'pendiente' | 'requires_review' | 'no_data' | 'skipped'> {
  const idSerial = bundle.site.id_serial;
  if (!idSerial) {
    logger.warn({ id_dgauser: user.id_dgauser, site_id: user.site_id }, 'DGA fill: sitio sin id_serial');
    return 'skipped';
  }

  const slotTs = new Date(slot.ts);
  const windowMs = periodicidadWindowMs(user.periodicidad);
  const windowStart = new Date(slotTs.getTime() - windowMs);

  const rawRows: HistoryEquipoRow[] = await getDashboardHistoryRange(
    idSerial,
    windowStart.toISOString(),
    slotTs.toISOString(),
  );
  // repo ordena DESC → [0] es la lectura más reciente dentro de la ventana.
  const representative = rawRows[0];
  if (!representative) {
    // Sin telemetría en la ventana: no actualizamos el slot, queda 'vacio'.
    return 'no_data';
  }

  const processed = mapHistoricalDashboardRow({
    row: representative,
    site: bundle.site,
    mappings: bundle.mappings,
    pozoConfig: bundle.pozoConfig,
  });

  const caudal = numericOrNull(processed.caudal.valor);
  // Para totalizador truncamos a entero (consistencia con formato SNIA y
  // con la vista cliente, evita inconsistencias visuales). El valor decimal
  // original solo se preserva si viene del importador legacy.
  const totalizadorRaw = numericOrNull(processed.totalizador.valor);
  const totalizador = totalizadorRaw == null ? null : Math.trunc(totalizadorRaw);
  const nivelFreatico = numericOrNull(processed.nivel_freatico.valor);

  // reg_map del totalizador trae flags como sensor_known_defective.
  const totalizadorMap = bundle.mappings.find((m) => m.rol_dashboard === 'totalizador');
  const totalizadorParams = (totalizadorMap?.parametros ?? {}) as Record<string, unknown>;

  // Sugerencia de fallback solo si la necesitamos: totalizador inválido o sensor defectuoso.
  let lastValidTotalizador: number | null = null;
  if (
    totalizador == null ||
    totalizador === 0 ||
    totalizadorParams.sensor_known_defective === true
  ) {
    lastValidTotalizador = await findLastValidTotalizador(Number(user.id_dgauser), slot.ts);
  }

  const validation = validateSlot(
    { caudal, totalizador, nivelFreatico },
    { user, totalizadorParams, lastValidTotalizador },
  );

  if (validation.ok) {
    const updated = await transitionSlotToPendiente({
      id_dgauser: Number(user.id_dgauser),
      ts: slot.ts,
      caudal_instantaneo: caudal,
      flujo_acumulado: totalizador,
      nivel_freatico: nivelFreatico,
    });
    return updated ? 'pendiente' : 'skipped';
  }

  const updated = await transitionSlotToRequiresReview({
    id_dgauser: Number(user.id_dgauser),
    ts: slot.ts,
    caudal_instantaneo: caudal,
    flujo_acumulado: totalizador,
    nivel_freatico: nivelFreatico,
    validation_warnings: validation.warnings,
    fail_reason: validation.failReason ?? 'unknown',
  });
  return updated ? 'requires_review' : 'skipped';
}

async function processInformante(user: DgaUserRow): Promise<void> {
  const bundle = await loadSiteBundle(user.site_id);
  if (!bundle) {
    logger.warn(
      { id_dgauser: user.id_dgauser, site_id: user.site_id },
      'DGA fill: sitio no encontrado',
    );
    return;
  }

  const slots = await listVacioSlotsForUser(Number(user.id_dgauser), MAX_SLOTS_PER_USER);
  if (slots.length === 0) return;

  let pendiente = 0;
  let requiresReview = 0;
  let noData = 0;

  for (const slot of slots) {
    try {
      const outcome = await fillSlot(user, bundle, slot);
      if (outcome === 'pendiente') pendiente++;
      else if (outcome === 'requires_review') requiresReview++;
      else if (outcome === 'no_data') noData++;
    } catch (err) {
      logger.error(
        { id_dgauser: user.id_dgauser, ts: slot.ts, err: (err as Error).message },
        'DGA fill: fallo en slot',
      );
    }
  }

  if (pendiente > 0 || requiresReview > 0) {
    logger.info(
      {
        id_dgauser: user.id_dgauser,
        site_id: user.site_id,
        pendiente,
        requires_review: requiresReview,
        no_data: noData,
        slots_total: slots.length,
      },
      'DGA fill: informante procesado',
    );
  }
}

async function runCycle(): Promise<void> {
  try {
    const users = await listActiveDgaUsers();
    for (const user of users) {
      // Re-lee por si transport/activo cambió en mitad del ciclo.
      const fresh = await findDgaUserById(Number(user.id_dgauser));
      if (!fresh || !fresh.activo) continue;
      await processInformante(fresh);
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
