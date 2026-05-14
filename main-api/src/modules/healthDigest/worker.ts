/**
 * Worker de salud (healthDigest).
 *
 * - Tick cada minuto: snapshot de lag de transmisión + lag DGA.
 * - Event-driven: si un sitio escala de tier (3h → 6h → 12h+), envía correo
 *   inmediato al destinatario primario.
 * - Digest 07:00 y 16:00 hora Santiago: resumen completo. Si todo OK envía
 *   correo "todo en orden".
 *
 * Estado en memoria. Restart re-notifica una vez por sitio aún en falla
 * (tradeoff aceptable). Cuando un sitio recupera (< 3h) se resetea su tier.
 *
 * Activación: env `ENABLE_HEALTH_DIGEST_WORKER=true`.
 */
import { logger } from '../../config/logger';
import { getDataTransmissionLag, getDgaUsersForMonitoring, type DgaUserRaw } from './repo';

export type IssueKind = 'data' | 'dga';
export type Tier = 'ok' | 't3' | 't6' | 't12';

const POLL_INTERVAL_MS = Number(process.env.HEALTH_DIGEST_POLL_MS ?? 60_000);
const MONITOR_PRIMARY = process.env.MONITOR_PRIMARY_EMAIL || 'druiz@emeltec.cl';
const WORKER_ENABLED = String(process.env.ENABLE_HEALTH_DIGEST_WORKER ?? 'false').toLowerCase() === 'true';
const DIGEST_HOURS = [7, 16];

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

async function fetchSnapshot(): Promise<{ data: IssueRow[]; dga: IssueRow[] }> {
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

async function detectAndEmitEvents(snap: { data: IssueRow[]; dga: IssueRow[] }): Promise<void> {
  const all = [...snap.data, ...snap.dga];
  for (const row of all) {
    const key = `${row.kind}:${row.id}`;
    const prev = tierState.get(key) ?? 'ok';
    if (TIER_ORDER[row.tier] > TIER_ORDER[prev]) {
      tierState.set(key, row.tier);
      logger.info(
        { kind: row.kind, site: row.descripcion, tier: row.tier, lagH: (row.lagMs / H_MS).toFixed(1) },
        'healthDigest: escalación → email event',
      );
      void emailMod
        .sendHealthDigest({ to: MONITOR_PRIMARY, mode: 'event', eventDetail: row })
        .catch((err) =>
          logger.error({ err: (err as Error).message }, 'healthDigest: fallo email event'),
        );
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

async function maybeSendDigest(snap: {
  data: IssueRow[];
  dga: IssueRow[];
}): Promise<void> {
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
  logger.info(
    { slot: slotKey, data: dataIssues.length, dga: dgaIssues.length },
    'healthDigest: enviando resumen programado',
  );
  await emailMod
    .sendHealthDigest({
      to: MONITOR_PRIMARY,
      mode: 'digest',
      generatedAt: new Date().toISOString(),
      dataIssues,
      dgaIssues,
    })
    .catch((err) =>
      logger.error({ err: (err as Error).message }, 'healthDigest: fallo email digest'),
    );
}

async function runCycle(): Promise<void> {
  try {
    const snap = await fetchSnapshot();
    await detectAndEmitEvents(snap);
    await maybeSendDigest(snap);
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
    { intervalMs: POLL_INTERVAL_MS, primary: MONITOR_PRIMARY, digestHours: DIGEST_HOURS },
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
