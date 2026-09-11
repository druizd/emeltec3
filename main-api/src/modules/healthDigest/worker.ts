/**
 * Worker de salud (healthDigest).
 *
 * - Tick cada minuto: snapshot de lag de transmisión + lag DGA.
 * - Event-driven: si un sitio escala de tier (3h → 6h → 12h+), envía correo
 *   inmediato a los destinatarios suscritos a eventos con umbral <= ese tier.
 * - Digest 07:00 y 16:00 hora Santiago: resumen completo. Si todo OK envía
 *   correo "todo en orden".
 *
 * Destinatarios: tabla `health_digest_destinatario`, administrada desde
 * /administration → "Alertas por correo". Si la lista queda vacía o la query
 * falla, cae a `MONITOR_PRIMARY_EMAIL` para no dejar el monitoreo mudo.
 *
 * Estado en memoria. Restart re-notifica una vez por sitio aún en falla
 * (tradeoff aceptable). Cuando un sitio recupera (< 3h) se resetea su tier.
 *
 * Activación: env `ENABLE_HEALTH_DIGEST_WORKER=true`.
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { getDataTransmissionLag, getDgaUsersForMonitoring, type DgaUserRaw } from './repo';
import { listDestinatariosActivos, type DigestDestinatario } from './destinatariosRepo';

export type IssueKind = 'data' | 'dga';
export type Tier = 'ok' | 't3' | 't6' | 't12';

const POLL_INTERVAL_MS = Number(process.env.HEALTH_DIGEST_POLL_MS ?? 60_000);
/** Buzón de respaldo: se usa solo si no hay destinatarios activos en la BD. */
export const MONITOR_PRIMARY = process.env.MONITOR_PRIMARY_EMAIL || 'druiz@emeltec.cl';
export const WORKER_ENABLED =
  String(process.env.ENABLE_HEALTH_DIGEST_WORKER ?? 'false').toLowerCase() === 'true';
export const DIGEST_HOURS = [7, 16];

const H_MS = 3_600_000;
const TIER_ORDER: Record<Tier, number> = { ok: 0, t3: 1, t6: 2, t12: 3 };

interface SendInput {
  to: string;
  mode: 'event' | 'digest';
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
    umbral_evento: 't3',
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

/** Destinatarios que deben recibir un evento de este tier. */
export function destinatariosParaEvento(
  destinatarios: DigestDestinatario[],
  tier: Tier,
): DigestDestinatario[] {
  return destinatarios.filter(
    (d) => d.recibe_eventos && TIER_ORDER[tier] >= TIER_ORDER[d.umbral_evento],
  );
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

async function detectAndEmitEvents(
  snap: { data: IssueRow[]; dga: IssueRow[] },
  destinatarios: DigestDestinatario[],
): Promise<void> {
  const all = [...snap.data, ...snap.dga];
  for (const row of all) {
    const key = `${row.kind}:${row.id}`;
    const prev = tierState.get(key) ?? 'ok';
    if (TIER_ORDER[row.tier] > TIER_ORDER[prev]) {
      // El tier se marca aunque nadie esté suscrito a este nivel: así el
      // siguiente escalón sigue siendo un evento nuevo y no se re-notifica el
      // mismo salto en cada ciclo.
      tierState.set(key, row.tier);
      const targets = destinatariosParaEvento(destinatarios, row.tier);
      logger.info(
        {
          kind: row.kind,
          site: row.descripcion,
          tier: row.tier,
          lagH: (row.lagMs / H_MS).toFixed(1),
          destinatarios: targets.length,
        },
        'healthDigest: escalación → email event',
      );
      for (const d of targets) {
        void emailMod
          .sendHealthDigest({ to: d.email, mode: 'event', eventDetail: row })
          .catch((err) =>
            logger.error(
              { err: (err as Error).message, to: d.email },
              'healthDigest: fallo email event',
            ),
          );
      }
    } else if (row.tier === 'ok' && prev !== 'ok') {
      tierState.set(key, 'ok');
    }
  }
}

function santiagoSlot(): { hour: number; minute: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
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

async function runCycle(): Promise<void> {
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
