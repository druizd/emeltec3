/**
 * Worker de salud (healthDigest): el resumen interno del equipo Emeltec.
 *
 * UN correo, dos veces al día, con dos secciones:
 *   1. Equipos sin transmitir hace más del umbral configurado (default 6 h).
 *   2. Reportes DGA atrasados.
 * Cada fila trae instalación, empresa, tiempo sin reportar y link al sitio.
 *
 * Qué cambió el 16-09-2026 y por qué:
 *
 * - **Se retiraron las escalaciones inmediatas** (un correo por instalación al
 *   cruzar 3 h → 6 h → 12 h). Su estado vivía en memoria, así que al recrearse
 *   el container todo lo que ya venía caído contaba como escalación nueva y
 *   salía de golpe, un correo por pozo. El resumen de dos veces al día cubre lo
 *   mismo sin esa ráfaga.
 * - **El horario y el umbral se administran en la plataforma**
 *   (/administration → "Alertas por correo"), no en el `.env` de la VM.
 * - **El slot ya no se pierde.** Antes el envío exigía que un ciclo cayera en el
 *   minuto 0 exacto (`minute === 0`); el `setInterval` de 60 s deriva con el
 *   trabajo de cada ciclo, y en cuanto un tick pasaba de `05:59:5x` a `06:01:0x`
 *   el resumen del día no salía y nadie se enteraba. Ahora hay ventana de
 *   rescate y el candado es una tabla, no un Set en memoria.
 *
 * Destinatarios: tabla `health_digest_destinatario`, administrada en la misma
 * pantalla. Si la lista queda vacía o la query falla, cae a
 * `MONITOR_PRIMARY_EMAIL` para no dejar el monitoreo mudo.
 *
 * Zona horaria: `America/Santiago` de verdad, no el `Etc/GMT+4` fijo del resto
 * de la plataforma. El horario de este correo se define por la hora a la que la
 * persona se sienta frente al computador; con UTC-4 fijo, en verano llegaría una
 * hora más tarde de lo configurado (por eso las horas habían tenido que correrse
 * a mano a 6 y 15 el 06-09-2026).
 *
 * Activación: env `ENABLE_HEALTH_DIGEST_WORKER=true`.
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { getClient } from '../../config/dbHelpers';
import { siteUrl } from '../../utils/siteUrl';
import { getDataTransmissionLag, getDgaUsersForMonitoring, type DgaUserRaw } from './repo';
import { listDestinatariosActivos, type DigestDestinatario } from './destinatariosRepo';
import { getConfig, type HealthDigestConfig } from './configRepo';

export type IssueKind = 'data' | 'dga';

const POLL_INTERVAL_MS = Number(process.env.HEALTH_DIGEST_POLL_MS ?? 60_000);
/** Buzón de respaldo: se usa solo si no hay destinatarios activos en la BD. */
export const MONITOR_PRIMARY = process.env.MONITOR_PRIMARY_EMAIL || 'druiz@emeltec.cl';
export const WORKER_ENABLED =
  String(process.env.ENABLE_HEALTH_DIGEST_WORKER ?? 'false').toLowerCase() === 'true';

/** Hora de pared chilena, con horario de verano. Ver el comentario de cabecera. */
export const DIGEST_TZ = 'America/Santiago';

/**
 * Cuánto hacia atrás se rescata un slot sin enviar. Cubre un reinicio o una
 * ventana de mantención corta; más allá de eso el resumen atrasado ya no le
 * sirve a nadie y lo que sigue caído sale en el slot siguiente igual.
 */
const LOOKBACK_MS = 2 * 3_600_000;

const H_MS = 3_600_000;

interface SendInput {
  to: string;
  generatedAt: string;
  umbralHoras: number;
  dataIssues: IssueRow[];
  dgaIssues: IssueRow[];
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
  tipoSitio: string | null;
  lagMs: number;
  lastAt: string | null;
  /** Link al detalle del sitio. Se arma acá y no en el template del correo:
   *  `siteUrl` es TS y `emailService` es CommonJS. */
  url: string;
  expectedAt?: string | null;
  periodicidad?: string;
}

let intervalHandle: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------- horarios

function partesEnZona(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset de la zona en minutos para ese instante (+ = al este de UTC). */
function offsetMinutos(at: Date, tz: string): number {
  const p = partesEnZona(at, tz);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (comoUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Instante UTC de una hora de pared chilena. Dos pasadas porque el offset
 * depende del instante que se está calculando: en el cambio de hora la primera
 * aproximación puede caer al otro lado del salto.
 */
export function instanteDeParedChile(
  year: number,
  month: number,
  day: number,
  hour: number,
  tz: string = DIGEST_TZ,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const off1 = offsetMinutos(new Date(guess), tz);
  let ts = guess - off1 * 60_000;
  const off2 = offsetMinutos(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2 * 60_000;
  return new Date(ts);
}

/**
 * Slots ya cumplidos que caen dentro de la ventana de rescate, del más antiguo
 * al más reciente. Se miran hoy y ayer (hora de Chile) porque un slot de las
 * 16:00 sigue siendo "de ayer" pasada la medianoche.
 */
export function slotsCumplidos(now: Date, horas: number[], tz: string = DIGEST_TZ): Date[] {
  const dias = [new Date(now.getTime() - 24 * H_MS), now].map((d) => partesEnZona(d, tz));
  const out: Date[] = [];
  for (const dia of dias) {
    for (const h of horas) {
      const slot = instanteDeParedChile(dia.year, dia.month, dia.day, h, tz);
      if (slot.getTime() <= now.getTime() && now.getTime() - slot.getTime() <= LOOKBACK_MS) {
        out.push(slot);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

// ---------------------------------------------------------------- snapshot

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
    // Las escalaciones inmediatas se retiraron; la columna sigue en la tabla.
    recibe_eventos: false,
    // Las alertas de seguridad no tienen buzón de respaldo: `auditAlerts` lee la
    // tabla directamente y una lista vacía significa no enviar. Este fallback es
    // solo del resumen, así que no se arroga esa suscripción.
    recibe_seguridad: false,
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

/**
 * Foto del estado: equipos que pasaron el umbral sin transmitir y reportes DGA
 * atrasados, ambos de peor a mejor. Un sitio sin ninguna transmisión registrada
 * va primero: es el peor caso, no el mejor.
 */
export async function buildSnapshot(
  umbralHoras: number,
): Promise<{ data: IssueRow[]; dga: IssueRow[] }> {
  const [dataRows, dgaRows] = await Promise.all([
    getDataTransmissionLag(),
    getDgaUsersForMonitoring(),
  ]);
  const now = Date.now();
  const umbralMs = umbralHoras * H_MS;
  const peorPrimero = (a: IssueRow, b: IssueRow) => b.lagMs - a.lagMs;

  const data: IssueRow[] = dataRows
    .map((r) => {
      const lastMs = r.last_received_at ? new Date(r.last_received_at).getTime() : 0;
      const lagMs = r.last_received_at ? Math.max(0, now - lastMs) : Number.MAX_SAFE_INTEGER;
      return {
        kind: 'data' as const,
        id: r.site_id,
        siteId: r.site_id,
        descripcion: r.descripcion,
        empresa: r.empresa_nombre ?? '',
        tipoSitio: r.tipo_sitio ?? null,
        lagMs,
        lastAt: r.last_received_at,
        url: siteUrl(r.site_id, r.tipo_sitio),
      };
    })
    .filter((r) => r.lagMs >= umbralMs)
    .sort(peorPrimero);

  const dga: IssueRow[] = dgaRows
    .map((u) => {
      const expected = expectedNextDga(u);
      return {
        kind: 'dga' as const,
        id: u.id_dgauser,
        siteId: u.site_id,
        descripcion: u.descripcion,
        empresa: u.empresa_nombre ?? '',
        tipoSitio: u.tipo_sitio ?? null,
        lagMs: Math.max(0, now - expected.getTime()),
        lastAt: u.last_run_at,
        url: siteUrl(u.site_id, u.tipo_sitio, 'dga'),
        expectedAt: expected.toISOString(),
        periodicidad: u.periodicidad,
      };
    })
    .filter((r) => r.lagMs >= umbralMs)
    .sort(peorPrimero);

  return { data, dga };
}

/** Envía el resumen a un correo puntual (lo usa el botón "Enviar prueba"). */
export async function sendDigestTo(
  email: string,
  dataIssues: IssueRow[],
  dgaIssues: IssueRow[],
  umbralHoras: number,
): Promise<void> {
  await emailMod.sendHealthDigest({
    to: email,
    generatedAt: new Date().toISOString(),
    umbralHoras,
    dataIssues,
    dgaIssues,
  });
}

// ---------------------------------------------------------------- envío

/**
 * Reclama el slot antes de mandar nada. Si otra réplica (o el ciclo anterior)
 * ya lo tomó, devuelve false y este ciclo no manda correo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reclamarSlot(client: any, slot: Date): Promise<boolean> {
  const r = (await client.query(
    `INSERT INTO health_digest_envios (slot_ts)
     VALUES ($1)
     ON CONFLICT (slot_ts) DO NOTHING
     RETURNING slot_ts`,
    [slot.toISOString()],
  )) as { rows: unknown[] };
  return r.rows.length > 0;
}

async function enviarResumen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  slot: Date,
  cfg: HealthDigestConfig,
): Promise<void> {
  const snap = await buildSnapshot(cfg.umbralHoras);
  const destinatarios = (await resolveDestinatarios()).filter((d) => d.recibe_resumen);

  logger.info(
    {
      slot: slot.toISOString(),
      equipos: snap.data.length,
      dga: snap.dga.length,
      destinatarios: destinatarios.length,
      umbralHoras: cfg.umbralHoras,
    },
    'healthDigest: enviando resumen programado',
  );

  // Un envío por destinatario (no un `to` múltiple): así un rechazo de Resend
  // en una dirección no se lleva el resumen del resto.
  for (const d of destinatarios) {
    await sendDigestTo(d.email, snap.data, snap.dga, cfg.umbralHoras).catch((err) =>
      logger.error(
        { err: (err as Error).message, to: d.email },
        'healthDigest: fallo el envío del resumen',
      ),
    );
  }

  await client.query(
    `UPDATE health_digest_envios
        SET equipos = $2, dga = $3, destinatarios = $4, enviado_at = NOW()
      WHERE slot_ts = $1`,
    [slot.toISOString(), snap.data.length, snap.dga.length, destinatarios.length],
  );
}

/** Un ciclo completo del worker. Exportado para poder testearlo sin timers. */
export async function runCycle(now: Date = new Date()): Promise<void> {
  beat('healthDigest');
  let client: Awaited<ReturnType<typeof getClient>> | null = null;
  try {
    const cfg = await getConfig();
    const slots = slotsCumplidos(now, cfg.horas);
    if (slots.length === 0) return;

    client = await getClient();
    for (const slot of slots) {
      if (!(await reclamarSlot(client, slot))) continue;
      await enviarResumen(client, slot, cfg);
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'healthDigest: error en ciclo');
  } finally {
    if (client) client.release();
  }
}

export function startHealthDigestWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('Health digest worker deshabilitado (ENABLE_HEALTH_DIGEST_WORKER!=true)');
    return;
  }
  logger.info(
    { intervalMs: POLL_INTERVAL_MS, fallback: MONITOR_PRIMARY, tz: DIGEST_TZ },
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
