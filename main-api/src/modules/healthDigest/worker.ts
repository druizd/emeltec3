/**
 * Worker de salud (healthDigest).
 *
 * - Tick cada minuto: snapshot de lag de transmisión + lag DGA.
 * - Event-driven: si un sitio escala de tier (3h → 6h → 12h+), avisa a los
 *   destinatarios suscritos a eventos con umbral <= ese tier. Las escalaciones
 *   de un mismo ciclo van en UN correo agrupado por tipo (transmisión / DGA) y
 *   por tramo de horas, no en un correo por instalación.
 * - Digest 06:00 y 15:00 hora Santiago: resumen completo. Si todo OK envía
 *   correo "todo en orden".
 *
 * Destinatarios: tabla `health_digest_destinatario`, administrada desde
 * /administration → "Alertas por correo". Si la lista queda vacía o la query
 * falla, cae a `MONITOR_PRIMARY_EMAIL` para no dejar el monitoreo mudo.
 *
 * Arranque: el estado de tiers vive en memoria, así que al levantar el proceso
 * TODO sitio que ya venía caído figura como escalación nueva. El 16-09-2026 eso
 * fue un correo por instalación de golpe apenas el container tomó
 * `ENABLE_HEALTH_DIGEST_WORKER=true`. Por eso el primer ciclo solo CEBA el
 * estado y no notifica: lo que está caído desde antes del arranque ya sale en
 * el resumen de las 06:00/15:00, y el correo inmediato queda para lo que
 * empeora con el worker vivo. `HEALTH_DIGEST_NOTIFY_ON_BOOT=true` lo desactiva.
 * Cuando un sitio recupera (< 3h) se resetea su tier.
 *
 * Activación: env `ENABLE_HEALTH_DIGEST_WORKER=true`.
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { getDataTransmissionLag, getDgaUsersForMonitoring, type DgaUserRaw } from './repo';
import { listDestinatariosActivos, type DigestDestinatario } from './destinatariosRepo';
import { CHILE_TIME_ZONE } from '../../shared/time';

export type IssueKind = 'data' | 'dga';
export type Tier = 'ok' | 't3' | 't6' | 't12';

const POLL_INTERVAL_MS = Number(process.env.HEALTH_DIGEST_POLL_MS ?? 60_000);
/** Buzón de respaldo: se usa solo si no hay destinatarios activos en la BD. */
export const MONITOR_PRIMARY = process.env.MONITOR_PRIMARY_EMAIL || 'druiz@emeltec.cl';
export const WORKER_ENABLED =
  String(process.env.ENABLE_HEALTH_DIGEST_WORKER ?? 'false').toLowerCase() === 'true';
/**
 * Si el primer ciclo tras arrancar puede mandar correos. Default `false`: ver
 * el bloque "Arranque" de la cabecera.
 */
export const NOTIFICAR_AL_ARRANCAR =
  String(process.env.HEALTH_DIGEST_NOTIFY_ON_BOOT ?? 'false').toLowerCase() === 'true';
/**
 * Horas de envío del resumen, en UTC-4 fijo (la zona de toda la plataforma).
 * Se corrieron una hora hacia atrás el 06-09-2026: con UTC-4 fijo, en horario
 * de verano las 07:00 caían a las 08:00 de reloj de pared, justo cuando el
 * cliente llega. A las 06:00 el correo está siempre en la bandeja antes de que
 * se siente, tanto en invierno (06:00 de pared) como en verano (07:00).
 */
export const DIGEST_HOURS = [6, 15];

const H_MS = 3_600_000;
const TIER_ORDER: Record<Tier, number> = { ok: 0, t3: 1, t6: 2, t12: 3 };

interface SendInput {
  to: string;
  mode: 'event' | 'escalaciones' | 'digest';
  generatedAt?: string;
  dataIssues?: IssueRow[];
  dgaIssues?: IssueRow[];
  eventDetail?: IssueRow;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../services/emailService.js') as {
  sendHealthDigest: (input: SendInput) => Promise<void>;
};

export interface IssueRow {
  kind: IssueKind;
  id: string;
  siteId: string;
  descripcion: string;
  empresa: string;
  lagMs: number;
  tier: Tier;
  lastAt: string | null;
  expectedAt?: string | null;
  periodicidad?: string;
}

const tierState = new Map<string, Tier>();
const sentDigestSlots = new Set<string>();
let intervalHandle: NodeJS.Timeout | null = null;
/** Falso hasta que el primer ciclo dejó el estado de tiers cargado. */
let estadoCebado = false;

/** Solo para tests: vuelve el worker al estado de recién importado. */
export function _resetEstadoInterno(): void {
  tierState.clear();
  sentDigestSlots.clear();
  estadoCebado = false;
}

function tierForLag(lagMs: number): Tier {
  if (lagMs >= 12 * H_MS) return 't12';
  if (lagMs >= 6 * H_MS) return 't6';
  if (lagMs >= 3 * H_MS) return 't3';
  return 'ok';
}

function periodMs(p: DgaUserRaw['periodicidad']): number {
  switch (p) {
    case 'hora':
      return H_MS;
    case 'dia':
      return 24 * H_MS;
    case 'semana':
      return 7 * 24 * H_MS;
    case 'mes':
      return 30 * 24 * H_MS;
    default:
      return 24 * H_MS;
  }
}

function expectedNextDga(u: DgaUserRaw): Date {
  if (u.last_run_at) {
    return new Date(new Date(u.last_run_at).getTime() + periodMs(u.periodicidad));
  }
  // fecha_inicio + hora_inicio están en hora local Chile (UTC-4).
  const hhmmss = u.hora_inicio.length === 5 ? `${u.hora_inicio}:00` : u.hora_inicio;
  return new Date(`${u.fecha_inicio}T${hhmmss}-04:00`);
}

function fallbackDestinatario(): DigestDestinatario {
  return {
    email: MONITOR_PRIMARY,
    nombre: null,
    recibe_resumen: true,
    recibe_eventos: true,
    // Las alertas de seguridad no tienen buzón de respaldo: `auditAlerts` lee la
    // tabla directamente y una lista vacía significa no enviar. Este fallback es
    // solo del digest, así que no se arroga esa suscripción.
    recibe_seguridad: false,
    // 12 h, igual que el default de la tabla desde el 16-09-2026: un hueco de
    // 3 h es ruido, y el buzón de respaldo no es lugar para descubrirlo.
    umbral_evento: 't12',
    activo: true,
    updated_at: null,
  };
}

/**
 * Destinatarios activos de la BD. Fail-open al buzón de respaldo: una tabla
 * vacía (o inexistente, si la migración no está aplicada) no debe silenciar el
 * monitoreo.
 */
export async function resolveDestinatarios(): Promise<DigestDestinatario[]> {
  try {
    const rows = await listDestinatariosActivos();
    if (rows.length > 0) return rows;
    logger.warn(
      { fallback: MONITOR_PRIMARY },
      'healthDigest: sin destinatarios activos → usando buzón de respaldo',
    );
  } catch (err) {
    logger.error(
      { err: (err as Error).message, fallback: MONITOR_PRIMARY },
      'healthDigest: no se pudo leer health_digest_destinatario → buzón de respaldo',
    );
  }
  return [fallbackDestinatario()];
}

/** ¿Este destinatario quiere enterarse de una escalación a este tramo? */
export function leToca(d: DigestDestinatario, tier: Tier): boolean {
  return d.recibe_eventos && TIER_ORDER[tier] >= TIER_ORDER[d.umbral_evento];
}

/** Destinatarios que deben recibir un evento de este tier. */
export function destinatariosParaEvento(
  destinatarios: DigestDestinatario[],
  tier: Tier,
): DigestDestinatario[] {
  return destinatarios.filter((d) => leToca(d, tier));
}

/** Envía el resumen a un correo puntual (lo usa el botón "Enviar prueba"). */
export async function sendDigestTo(
  email: string,
  dataIssues: IssueRow[],
  dgaIssues: IssueRow[],
): Promise<void> {
  await emailMod.sendHealthDigest({
    to: email,
    mode: 'digest',
    generatedAt: new Date().toISOString(),
    dataIssues,
    dgaIssues,
  });
}

export async function buildSnapshot(): Promise<{ data: IssueRow[]; dga: IssueRow[] }> {
  const [dataRows, dgaRows] = await Promise.all([
    getDataTransmissionLag(),
    getDgaUsersForMonitoring(),
  ]);
  const now = Date.now();

  const data: IssueRow[] = dataRows.map((r) => {
    const lastMs = r.last_received_at ? new Date(r.last_received_at).getTime() : 0;
    const lagMs = r.last_received_at ? Math.max(0, now - lastMs) : Number.MAX_SAFE_INTEGER;
    return {
      kind: 'data',
      id: r.site_id,
      siteId: r.site_id,
      descripcion: r.descripcion,
      empresa: r.empresa_nombre ?? '',
      lagMs,
      tier: tierForLag(lagMs),
      lastAt: r.last_received_at,
    };
  });

  const dga: IssueRow[] = dgaRows.map((u) => {
    const expected = expectedNextDga(u);
    const lagMs = Math.max(0, now - expected.getTime());
    return {
      kind: 'dga',
      id: u.id_dgauser,
      siteId: u.site_id,
      descripcion: u.descripcion,
      empresa: u.empresa_nombre ?? '',
      lagMs,
      tier: tierForLag(lagMs),
      lastAt: u.last_run_at,
      expectedAt: expected.toISOString(),
      periodicidad: u.periodicidad,
    };
  });

  return { data, dga };
}

/**
 * Instalaciones que subieron de tramo en este ciclo. Marca el estado nuevo
 * aunque nadie esté suscrito a ese nivel: así el siguiente escalón sigue siendo
 * un evento nuevo y no se re-notifica el mismo salto en cada ciclo.
 */
export function detectarEscalaciones(snap: { data: IssueRow[]; dga: IssueRow[] }): IssueRow[] {
  const escaladas: IssueRow[] = [];
  for (const row of [...snap.data, ...snap.dga]) {
    const key = `${row.kind}:${row.id}`;
    const prev = tierState.get(key) ?? 'ok';
    if (TIER_ORDER[row.tier] > TIER_ORDER[prev]) {
      tierState.set(key, row.tier);
      escaladas.push(row);
    } else if (row.tier === 'ok' && prev !== 'ok') {
      tierState.set(key, 'ok');
    }
  }
  return escaladas;
}

/**
 * Manda las escalaciones del ciclo: UN correo por destinatario, con todo lo que
 * escaló adentro. Antes era un correo por instalación y por destinatario, que
 * con una caída transversal (o con el worker recién arrancado) significaba
 * cuarenta correos seguidos.
 *
 * Con una sola escalación se manda igual el correo de evento de siempre, que
 * trae el detalle completo de esa instalación; el agrupado aparece solo cuando
 * de verdad hay varias.
 */
async function emitirEscalaciones(
  escaladas: IssueRow[],
  destinatarios: DigestDestinatario[],
): Promise<void> {
  for (const d of destinatarios) {
    const suyas = escaladas.filter((row) => leToca(d, row.tier));
    if (suyas.length === 0) continue;

    const input: SendInput =
      suyas.length === 1
        ? { to: d.email, mode: 'event', eventDetail: suyas[0]! }
        : {
            to: d.email,
            mode: 'escalaciones',
            generatedAt: new Date().toISOString(),
            dataIssues: suyas.filter((r) => r.kind === 'data'),
            dgaIssues: suyas.filter((r) => r.kind === 'dga'),
          };

    await emailMod
      .sendHealthDigest(input)
      .catch((err) =>
        logger.error(
          { err: (err as Error).message, to: d.email },
          'healthDigest: fallo email de escalaciones',
        ),
      );
  }
}

async function detectAndEmitEvents(
  snap: { data: IssueRow[]; dga: IssueRow[] },
  destinatarios: DigestDestinatario[],
): Promise<void> {
  const escaladas = detectarEscalaciones(snap);

  // Primer ciclo: el estado en memoria estaba vacío, así que "escaló" todo lo
  // que ya venía caído desde antes de arrancar. Eso no es noticia — es el
  // backlog, y sale en el resumen programado.
  if (!estadoCebado) {
    estadoCebado = true;
    if (!NOTIFICAR_AL_ARRANCAR) {
      logger.info(
        { instalaciones: escaladas.length },
        'healthDigest: primer ciclo, estado de tiers cebado sin notificar',
      );
      return;
    }
  }

  if (escaladas.length === 0) return;

  logger.info(
    {
      instalaciones: escaladas.length,
      data: escaladas.filter((r) => r.kind === 'data').length,
      dga: escaladas.filter((r) => r.kind === 'dga').length,
      peorTier: escaladas.reduce<Tier>(
        (acc, r) => (TIER_ORDER[r.tier] > TIER_ORDER[acc] ? r.tier : acc),
        'ok',
      ),
    },
    'healthDigest: escalaciones del ciclo → un correo por destinatario',
  );
  await emitirEscalaciones(escaladas, destinatarios);
}

function santiagoSlot(): { hour: number; minute: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

async function maybeSendDigest(
  snap: { data: IssueRow[]; dga: IssueRow[] },
  destinatarios: DigestDestinatario[],
): Promise<void> {
  const { hour, minute, ymd } = santiagoSlot();
  if (minute !== 0 || !DIGEST_HOURS.includes(hour)) return;
  const slotKey = `${ymd}#${hour.toString().padStart(2, '0')}`;
  if (sentDigestSlots.has(slotKey)) return;
  sentDigestSlots.add(slotKey);
  // Limpieza: mantener últimos 10 slots.
  if (sentDigestSlots.size > 10) {
    const arr = [...sentDigestSlots];
    arr.slice(0, arr.length - 10).forEach((k) => sentDigestSlots.delete(k));
  }
  const dataIssues = snap.data.filter((r) => r.tier !== 'ok');
  const dgaIssues = snap.dga.filter((r) => r.tier !== 'ok');
  const targets = destinatarios.filter((d) => d.recibe_resumen);
  logger.info(
    {
      slot: slotKey,
      data: dataIssues.length,
      dga: dgaIssues.length,
      destinatarios: targets.length,
    },
    'healthDigest: enviando resumen programado',
  );
  // Un envío por destinatario (no un `to` múltiple): así un rechazo de Resend
  // en una dirección no se lleva el resumen del resto.
  for (const d of targets) {
    await sendDigestTo(d.email, dataIssues, dgaIssues).catch((err) =>
      logger.error(
        { err: (err as Error).message, to: d.email },
        'healthDigest: fallo email digest',
      ),
    );
  }
}

/** Un ciclo completo del worker. Exportado para poder testearlo sin timers. */
export async function runCycle(): Promise<void> {
  beat('healthDigest');
  try {
    const snap = await buildSnapshot();
    const destinatarios = await resolveDestinatarios();
    await detectAndEmitEvents(snap, destinatarios);
    await maybeSendDigest(snap, destinatarios);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'healthDigest: error en ciclo');
  }
}

export function startHealthDigestWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('Health digest worker deshabilitado (ENABLE_HEALTH_DIGEST_WORKER!=true)');
    return;
  }
  logger.info(
    { intervalMs: POLL_INTERVAL_MS, fallback: MONITOR_PRIMARY, digestHours: DIGEST_HOURS },
    'Health digest worker iniciado',
  );
  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopHealthDigestWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Health digest worker detenido');
}
