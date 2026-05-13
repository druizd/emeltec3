/**
 * Worker DGA.
 *
 * Cada N segundos:
 *   1) Lista `dga_user` activos.
 *   2) Para cada informante, calcula el próximo bucket según `periodicidad`
 *      desde `last_run_at` (o `fecha_inicio + hora_inicio` si no corrió aún).
 *   3) Si el bucket ya está vencido (<= now), procesa: lee `equipo` por rango,
 *      reusa `applyMappingTransform` (transformaciones físicas existentes),
 *      extrae caudal_instantaneo / flujo_acumulado / nivel_freatico y los
 *      snapshotea a `dato_dga` (PRIMARY KEY (id_dgauser, ts) → idempotente).
 *   4) Marca `last_run_at` = ts del bucket procesado.
 *
 * Catch-up: si el informante estuvo inactivo, procesa hasta MAX_CATCHUP_BUCKETS
 * por ciclo para evitar bloquear el event loop.
 *
 * En cluster con réplicas, encender SOLO en una vía `ENABLE_DGA_WORKER=true`.
 */
import { logger } from '../../config/logger';
import {
  findDgaUserById,
  insertDatoDga,
  listActiveDgaUsers,
  markDgaUserRun,
  type DgaUserRow,
} from './repo';
import {
  getMappingsBySiteId,
  getPozoConfigBySiteId,
  getSiteById,
} from '../sites/repo';
import { getDashboardHistoryRange } from '../sites/repo';
import { mapHistoricalDashboardRow } from '../sites/service';
import type { HistoryEquipoRow, RegMap, PozoConfig, Site } from '../sites/types';

const POLL_INTERVAL_MS = Number(process.env.DGA_WORKER_POLL_MS ?? 60_000);
const MAX_CATCHUP_BUCKETS = Number(process.env.DGA_WORKER_CATCHUP ?? 24);
const WORKER_ENABLED =
  String(process.env.ENABLE_DGA_WORKER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

function periodicidadMs(periodicidad: DgaUserRow['periodicidad']): number {
  switch (periodicidad) {
    case 'hora':
      return 60 * 60 * 1000;
    case 'dia':
      return 24 * 60 * 60 * 1000;
    case 'semana':
      return 7 * 24 * 60 * 60 * 1000;
    case 'mes':
      // Aproximación de 30 días. DGA acepta cadencia mensual aproximada.
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

/**
 * Construye el TIMESTAMPTZ UTC inicial del informante a partir de su
 * `fecha_inicio` + `hora_inicio`. Esos valores fueron capturados en hora local
 * Chile (UTC-4), por lo que sumamos +4 horas para obtener el instante UTC.
 */
function combinarFechaHoraInicio(fechaIso: string, horaIso: string): Date {
  const hhmmss = horaIso.length === 5 ? `${horaIso}:00` : horaIso;
  // fechaIso = YYYY-MM-DD (zona Chile UTC-4) → instante UTC = local + 4h
  return new Date(`${fechaIso}T${hhmmss}-04:00`);
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
 * Procesa un único bucket: lee equipo en el rango [bucketStart, bucketEnd),
 * agrega y snapshot a dato_dga. Devuelve true si se insertó algo.
 */
async function processBucket(
  user: DgaUserRow,
  bundle: SiteBundle,
  bucketEnd: Date,
  bucketStart: Date,
): Promise<boolean> {
  const idSerial = bundle.site.id_serial;
  if (!idSerial) {
    logger.warn(
      { id_dgauser: user.id_dgauser, site_id: user.site_id },
      'DGA worker: sitio sin id_serial — se omite',
    );
    return false;
  }

  const rawRows: HistoryEquipoRow[] = await getDashboardHistoryRange(
    idSerial,
    bucketStart.toISOString(),
    bucketEnd.toISOString(),
  );
  if (rawRows.length === 0) {
    // Sin datos en el bucket: avanzamos last_run_at igual para no quedar en loop.
    return false;
  }

  // Tomamos la lectura más reciente del bucket como representativa.
  // Repo ordena DESC, así que rawRows[0] es la más reciente.
  const representative = rawRows[0];
  const processed = mapHistoricalDashboardRow({
    row: representative,
    site: bundle.site,
    mappings: bundle.mappings,
    pozoConfig: bundle.pozoConfig,
  });

  const obra = bundle.pozoConfig?.obra_dga?.trim() || bundle.site.descripcion;

  await insertDatoDga({
    id_dgauser: Number(user.id_dgauser),
    obra,
    ts: bucketEnd.toISOString(),
    caudal_instantaneo: numericOrNull(processed.caudal.valor),
    flujo_acumulado: numericOrNull(processed.totalizador.valor),
    nivel_freatico: numericOrNull(processed.nivel_freatico.valor),
  });
  return true;
}

async function processInformante(user: DgaUserRow): Promise<void> {
  const inicio = user.last_run_at
    ? new Date(user.last_run_at)
    : combinarFechaHoraInicio(user.fecha_inicio, user.hora_inicio);
  if (Number.isNaN(inicio.getTime())) {
    logger.warn({ id_dgauser: user.id_dgauser }, 'DGA worker: fecha_inicio inválida');
    return;
  }

  const stepMs = periodicidadMs(user.periodicidad);
  const now = Date.now();

  if (inicio.getTime() > now) return; // todavía no arranca

  const bundle = await loadSiteBundle(user.site_id);
  if (!bundle) {
    logger.warn({ id_dgauser: user.id_dgauser, site_id: user.site_id }, 'DGA worker: sitio no encontrado');
    return;
  }

  let cursor = inicio.getTime() + stepMs;
  let processed = 0;
  while (cursor <= now && processed < MAX_CATCHUP_BUCKETS) {
    const bucketEnd = new Date(cursor);
    const bucketStart = new Date(cursor - stepMs);
    try {
      const inserted = await processBucket(user, bundle, bucketEnd, bucketStart);
      await markDgaUserRun(Number(user.id_dgauser), bucketEnd.toISOString());
      if (inserted) processed++;
    } catch (err) {
      logger.error(
        { id_dgauser: user.id_dgauser, err: (err as Error).message },
        'DGA worker: fallo al procesar bucket',
      );
      return;
    }
    cursor += stepMs;
  }
}

async function runCycle(): Promise<void> {
  try {
    const users = await listActiveDgaUsers();
    for (const user of users) {
      // Refrescar last_run_at de la BD por si otro ciclo lo movió.
      const fresh = await findDgaUserById(Number(user.id_dgauser));
      if (!fresh || !fresh.activo) continue;
      await processInformante(fresh);
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'DGA worker: ciclo falló');
  }
}

export function startDgaWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('DGA worker deshabilitado (ENABLE_DGA_WORKER=false)');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'DGA worker iniciado');
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
  logger.info('DGA worker detenido');
}
