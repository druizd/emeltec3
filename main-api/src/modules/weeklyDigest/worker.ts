/**
 * Worker del resumen semanal: el recap de alertas abiertas que recibe el
 * cliente.
 *
 * UN correo por semana y por suscriptor, con dos secciones:
 *   1. **En falla ahora** — episodios abiertos cuya condición sigue activa.
 *   2. **Normalizadas, pendientes de acuse** — episodios que ya se arreglaron
 *      solos pero que nadie dio por recibidos, así que la regla sigue sin
 *      rearmarse.
 *
 * La separación no es cosmética: un episodio abierto NO implica que el pozo
 * esté fallando hoy. Sin acuse el episodio queda abierto aunque la condición se
 * normalice (es lo que evita el correo por hora, ver `alerts/worker.ts`), así
 * que mezclar las dos listas haría que el cliente leyera como "activas" cosas
 * que ya pasaron. La segunda sección es además el recordatorio de que el acuse
 * es lo que rearma la regla.
 *
 * Dónde encaja: NO reemplaza nada. El aviso inmediato por incidencia sigue
 * igual y el resumen interno de Emeltec también. Este es el tercer correo, y es
 * un recap, no un aviso — decisión del usuario del 23-09-2026.
 *
 * Alcance: cada suscriptor ve solo los sitios que podría abrir en la
 * plataforma, resuelto con `canReadSite` (la misma función que usa el
 * middleware de la API). Sin eso, un usuario de una sub-empresa vería pozos de
 * otra en el correo.
 *
 * Zona horaria: `America/Santiago` de verdad, como el resumen interno. La hora
 * de envío se define por la hora a la que la persona se sienta frente al
 * computador.
 *
 * Activación: env `ENABLE_WEEKLY_DIGEST_WORKER=true`.
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import { getClient } from '../../config/dbHelpers';
import { siteUrl } from '../../utils/siteUrl';
import { canReadSite } from '../../shared/permissions';
import { getAlertasAbiertas, getSuscriptores, type AlertaAbiertaRaw } from './repo';
import { getConfig, type WeeklyDigestConfig } from './configRepo';

const POLL_INTERVAL_MS = Number(process.env.WEEKLY_DIGEST_POLL_MS ?? 60_000);
export const WORKER_ENABLED =
  String(process.env.ENABLE_WEEKLY_DIGEST_WORKER ?? 'false').toLowerCase() === 'true';

/** Hora de pared chilena, con horario de verano. */
export const DIGEST_TZ = 'America/Santiago';

/**
 * Ventana de rescate de un slot sin enviar. Más ancha que la del resumen
 * interno (2 h) porque acá el siguiente intento no es en unas horas sino en una
 * semana: vale la pena rescatar un slot que se perdió por un reinicio largo.
 */
const LOOKBACK_MS = 12 * 3_600_000;

const H_MS = 3_600_000;
const DIA_MS = 24 * H_MS;

export interface FilaResumen {
  eventoId: number;
  /** "CCU · Quilicura · Pozo 4 · OB-1306-98" */
  sitio: string;
  siteId: string;
  alerta: string;
  severidad: string;
  valor: string | null;
  /** Días que lleva el episodio abierto. */
  dias: number;
  repeticiones: number;
  url: string;
}

interface SendInput {
  to: string;
  nombre: string;
  generatedAt: string;
  enFalla: FilaResumen[];
  pendientesAcuse: FilaResumen[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../services/emailService.js') as {
  sendWeeklyDigest: (input: SendInput) => Promise<void>;
};

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
 * depende del instante que se calcula: en el cambio de hora la primera
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

/** Día ISO (1 = lunes … 7 = domingo) de una fecha en hora de Chile. */
export function diaIsoEnChile(at: Date, tz: string = DIGEST_TZ): number {
  const p = partesEnZona(at, tz);
  // getUTCDay sobre la fecha de pared: 0 = domingo → 7.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * Slots ya cumplidos dentro de la ventana de rescate, del más antiguo al más
 * reciente. Se revisan los últimos 8 días para cubrir el slot de la semana
 * pasada aunque el día configurado haya cambiado hace poco.
 *
 * Igual que en el resumen interno: nada de `minute === 0`. El `setInterval` de
 * 60 s deriva con el trabajo de cada ciclo, y un tick que pase de `07:59:5x` a
 * `08:01:0x` perdería el correo de la semana sin dejar rastro.
 */
export function slotsCumplidos(
  now: Date,
  cfg: Pick<WeeklyDigestConfig, 'diaSemana' | 'hora'>,
  tz: string = DIGEST_TZ,
): Date[] {
  const out: Date[] = [];
  for (let i = 8; i >= 0; i--) {
    const dia = new Date(now.getTime() - i * DIA_MS);
    if (diaIsoEnChile(dia, tz) !== cfg.diaSemana) continue;
    const p = partesEnZona(dia, tz);
    const slot = instanteDeParedChile(p.year, p.month, p.day, cfg.hora, tz);
    const edad = now.getTime() - slot.getTime();
    if (edad >= 0 && edad <= LOOKBACK_MS) out.push(slot);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

// ---------------------------------------------------------------- snapshot

/** "CCU · Quilicura · Pozo 4 · OB-1306-98", sin repetir la sub-empresa. */
export function etiquetaSitio(r: AlertaAbiertaRaw): string {
  const empresa = r.empresa_nombre?.trim() || '';
  const sub = r.sub_empresa_nombre?.trim() || '';
  return [
    empresa,
    sub && sub.toLowerCase() !== empresa.toLowerCase() ? sub : '',
    r.sitio_desc?.trim() || r.sitio_id,
    r.obra_dga?.trim() || '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const SEV_RANK: Record<string, number> = { critica: 4, alta: 3, media: 2, baja: 1 };

export function aFila(r: AlertaAbiertaRaw, now: Date): FilaResumen {
  const desde = r.triggered_at ? new Date(r.triggered_at).getTime() : now.getTime();
  return {
    eventoId: r.id,
    sitio: etiquetaSitio(r),
    siteId: r.sitio_id,
    alerta: r.alerta_nombre,
    severidad: r.severidad,
    valor: r.valor_texto ?? r.valor_detectado ?? null,
    dias: Math.max(0, Math.floor((now.getTime() - desde) / DIA_MS)),
    repeticiones: r.repeticiones ?? 0,
    url: siteUrl(r.sitio_id, r.tipo_sitio, 'alertas'),
  };
}

/** Peor primero: por severidad y, a igual severidad, la más antigua arriba. */
function peorPrimero(a: FilaResumen, b: FilaResumen): number {
  const sev = (SEV_RANK[b.severidad] ?? 0) - (SEV_RANK[a.severidad] ?? 0);
  return sev !== 0 ? sev : b.dias - a.dias;
}

/**
 * Las filas que le tocan a un suscriptor, ya separadas en las dos secciones.
 * `canReadSite` decide con el alcance ACTUAL del sitio.
 */
export function filasParaSuscriptor(
  suscriptor: { tipo: string; empresa_id?: string | null; sub_empresa_id?: string | null },
  abiertas: AlertaAbiertaRaw[],
  now: Date,
): { enFalla: FilaResumen[]; pendientesAcuse: FilaResumen[] } {
  const enFalla: FilaResumen[] = [];
  const pendientesAcuse: FilaResumen[] = [];
  for (const r of abiertas) {
    const visible = canReadSite(suscriptor as Parameters<typeof canReadSite>[0], {
      empresa_id: r.empresa_id,
      sub_empresa_id: r.sub_empresa_id,
    });
    if (!visible) continue;
    // `normalizada_at` se limpia en cuanto la condición vuelve, así que esto
    // refleja el estado de ahora, no el histórico del episodio.
    (r.normalizada_at ? pendientesAcuse : enFalla).push(aFila(r, now));
  }
  return {
    enFalla: enFalla.sort(peorPrimero),
    pendientesAcuse: pendientesAcuse.sort(peorPrimero),
  };
}

/** Envía el resumen a un correo puntual (lo usa el botón "Enviar prueba"). */
export async function sendDigestTo(
  email: string,
  nombre: string,
  enFalla: FilaResumen[],
  pendientesAcuse: FilaResumen[],
): Promise<void> {
  await emailMod.sendWeeklyDigest({
    to: email,
    nombre,
    generatedAt: new Date().toISOString(),
    enFalla,
    pendientesAcuse,
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
    `INSERT INTO weekly_digest_envios (slot_ts)
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
  now: Date,
): Promise<void> {
  const suscriptores = await getSuscriptores();
  if (suscriptores.length === 0) {
    logger.info({ slot: slot.toISOString() }, 'weeklyDigest: nadie suscrito, no se envía nada');
    return;
  }

  const abiertas = await getAlertasAbiertas();
  let enviados = 0;
  let filasTotales = 0;

  // Un envío por destinatario, no un `to` múltiple: cada uno ve un contenido
  // distinto (su alcance), y además un rechazo de Resend en una dirección no se
  // lleva el resumen del resto.
  for (const s of suscriptores) {
    const { enFalla, pendientesAcuse } = filasParaSuscriptor(s, abiertas, now);
    const nombre = `${s.nombre} ${s.apellido ?? ''}`.trim();
    // Se manda aunque no haya nada: "sin alertas activas" es información, y un
    // correo que solo llega con malas noticias termina en la carpeta de ruido.
    await sendDigestTo(s.email, nombre, enFalla, pendientesAcuse)
      .then(() => {
        enviados++;
        filasTotales += enFalla.length + pendientesAcuse.length;
      })
      .catch((err) =>
        logger.error(
          { err: (err as Error).message, to: s.email },
          'weeklyDigest: falló el envío del resumen',
        ),
      );
  }

  logger.info(
    {
      slot: slot.toISOString(),
      suscriptores: suscriptores.length,
      enviados,
      abiertas: abiertas.length,
    },
    'weeklyDigest: resumen semanal enviado',
  );

  await client.query(
    `UPDATE weekly_digest_envios
        SET destinatarios = $2, alertas = $3, enviado_at = NOW()
      WHERE slot_ts = $1`,
    [slot.toISOString(), enviados, filasTotales],
  );
}

/** Un ciclo completo del worker. Exportado para poder testearlo sin timers. */
export async function runCycle(now: Date = new Date()): Promise<void> {
  beat('weeklyDigest');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any = null;
  try {
    const cfg = await getConfig();
    if (!cfg.activo) return;
    const slots = slotsCumplidos(now, cfg);
    if (slots.length === 0) return;

    client = await getClient();
    for (const slot of slots) {
      if (!(await reclamarSlot(client, slot))) continue;
      await enviarResumen(client, slot, now);
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'weeklyDigest: error en ciclo');
  } finally {
    if (client) client.release();
  }
}

export function startWeeklyDigestWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('Weekly digest worker deshabilitado (ENABLE_WEEKLY_DIGEST_WORKER!=true)');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS, tz: DIGEST_TZ }, 'Weekly digest worker iniciado');
  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopWeeklyDigestWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
}
