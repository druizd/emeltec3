/**
 * Worker de alertas. Polling de `alertas` activas, evalúa contra última lectura
 * de `equipo`, dispara eventos + notificaciones por email.
 *
 * Activación: env `ENABLE_ALERTS_WORKER=true` (default true). En despliegues con
 * múltiples réplicas, encender SOLO en una para evitar duplicación de eventos.
 */
import { getClient, query } from '../../config/dbHelpers';
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';
interface AlertRegla {
  nombre: string;
  severidad: string;
  reg_alias?: string;
  variable_key: string;
  sitio_desc?: string;
  sitio_id: string;
  valor_detectado?: unknown;
  condicion_texto?: string;
  condicion: string;
  id_serial?: string;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../services/emailService.js') as {
  sendAlertEmail: (to: string, name: string, msg: string, alerta: AlertRegla) => Promise<void>;
};
const { sendAlertEmail } = emailMod;

const POLL_INTERVAL_MS = Number(process.env.ALERT_POLL_MS ?? 60_000);
const DIAS_VALIDOS = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
] as const;

let intervalHandle: NodeJS.Timeout | null = null;

interface Alerta {
  id: string;
  nombre: string;
  empresa_id: string;
  sub_empresa_id: string | null;
  sitio_id: string;
  creado_por: string;
  variable_key: string;
  condicion: 'mayor_que' | 'menor_que' | 'igual_a' | 'fuera_rango' | 'sin_datos' | string;
  umbral_bajo: number;
  umbral_alto: number;
  severidad: string;
  cooldown_minutos: number;
  dias_activos: string[] | null;
  id_serial: string;
  sitio_desc: string;
}

function evalCondicion(
  condicion: Alerta['condicion'],
  valor: number,
  bajo: number,
  alto: number,
): boolean {
  switch (condicion) {
    case 'mayor_que':
      return valor > bajo;
    case 'menor_que':
      return valor < bajo;
    case 'igual_a':
      return valor === bajo;
    case 'fuera_rango':
      return valor < bajo || valor > alto;
    default:
      return false;
  }
}

function diaActual(): string {
  const localDate = new Date(
    new Date().toLocaleString('en-US', {
      timeZone: process.env.ALERT_TIMEZONE ?? 'America/Santiago',
    }),
  );
  return DIAS_VALIDOS[localDate.getDay()] ?? 'domingo';
}

function estaActivoHoy(alerta: Alerta): boolean {
  if (!Array.isArray(alerta.dias_activos) || alerta.dias_activos.length === 0) return true;
  return alerta.dias_activos.includes(diaActual());
}

function formatValor(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? 'sin dato disponible' : String(valor);
}

function formatCondicion(alerta: Alerta): string {
  switch (alerta.condicion) {
    case 'mayor_que':
      return `debe ser mayor que ${alerta.umbral_bajo}`;
    case 'menor_que':
      return `debe ser menor que ${alerta.umbral_bajo}`;
    case 'igual_a':
      return `debe ser igual a ${alerta.umbral_bajo}`;
    case 'fuera_rango':
      return `debe estar fuera del rango ${alerta.umbral_bajo} - ${alerta.umbral_alto}`;
    case 'sin_datos':
      return `sin datos durante ${alerta.cooldown_minutos} minutos`;
    default:
      return alerta.condicion;
  }
}

function buildMensaje(alerta: Alerta, valor: number | null): string {
  const sitio = alerta.sitio_desc ?? alerta.sitio_id;
  const severidad = alerta.severidad.toUpperCase();
  if (alerta.condicion === 'sin_datos') {
    return `[${severidad}] Sin datos en ${sitio}. Equipo ${alerta.id_serial} no reporta informacion hace mas de ${alerta.cooldown_minutos} minutos.`;
  }
  return `[${severidad}] ${sitio}. Variable ${alerta.variable_key}: valor detectado ${formatValor(valor)}. Regla: ${formatCondicion(alerta)}.`;
}

async function notificarUsuarios(
  alerta: Alerta & { valor_detectado: string; condicion_texto: string },
  eventoId: string,
  mensaje: string,
): Promise<void> {
  const usuarios = await query<{
    id: string;
    email: string;
    nombre: string;
    apellido: string | null;
  }>(
    `SELECT DISTINCT id, email, nombre, apellido FROM usuario
     WHERE tipo = 'SuperAdmin' OR id = $1`,
    [alerta.creado_por],
    { name: 'alerts__notify_users' },
  );
  for (const u of usuarios.rows) {
    await sendAlertEmail(
      u.email,
      `${u.nombre} ${u.apellido ?? ''}`.trim(),
      mensaje,
      alerta as unknown as AlertRegla,
    ).catch(() => undefined);
  }
  await query(`UPDATE alertas_eventos SET notificado = TRUE WHERE id = $1`, [eventoId], {
    name: 'alerts__mark_notified',
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evaluarAlerta(client: any, alerta: Alerta): Promise<void> {
  if (!estaActivoHoy(alerta)) return;

  const cool = await client.query(
    `SELECT triggered_at FROM alertas_eventos
     WHERE alerta_id = $1 AND triggered_at > NOW() - ($2 || ' minutes')::INTERVAL
     ORDER BY triggered_at DESC LIMIT 1`,
    [alerta.id, alerta.cooldown_minutos],
  );
  if (cool.rows.length > 0) return;

  if (alerta.condicion === 'sin_datos') {
    const r = await client.query(
      `SELECT received_at FROM equipo
       WHERE id_serial = $1 AND received_at > NOW() - ($2 || ' minutes')::INTERVAL
       LIMIT 1`,
      [alerta.id_serial, alerta.cooldown_minutos],
    );
    if (r.rows.length === 0) await insertarEvento(client, alerta, null, null);
    return;
  }

  const latest = (await client.query(
    `SELECT data FROM equipo WHERE id_serial = $1 ORDER BY time DESC LIMIT 1`,
    [alerta.id_serial],
  )) as { rows: Array<{ data: Record<string, unknown> }> };
  if (latest.rows.length === 0) return;
  const rawVal = latest.rows[0]!.data[alerta.variable_key];
  if (rawVal === undefined) return;
  const valorNum = parseFloat(String(rawVal));
  const valorTexto = String(rawVal);
  if (
    !Number.isNaN(valorNum) &&
    evalCondicion(alerta.condicion, valorNum, alerta.umbral_bajo, alerta.umbral_alto)
  ) {
    await insertarEvento(client, alerta, valorNum, valorTexto);
  }
}

async function insertarEvento(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  alerta: Alerta,
  valorNum: number | null,
  valorTexto: string | null,
): Promise<void> {
  const mensaje = buildMensaje(alerta, valorNum);
  const ctx = {
    ...alerta,
    valor_detectado: formatValor(valorNum),
    condicion_texto: formatCondicion(alerta),
  };
  const ins = (await client.query(
    `INSERT INTO alertas_eventos
       (alerta_id, empresa_id, sub_empresa_id, sitio_id, variable_key,
        valor_detectado, valor_texto, mensaje, severidad)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      alerta.id,
      alerta.empresa_id,
      alerta.sub_empresa_id ?? null,
      alerta.sitio_id,
      alerta.variable_key,
      valorNum,
      valorTexto,
      mensaje,
      alerta.severidad,
    ],
  )) as { rows: Array<{ id: string }> };
  notificarUsuarios(ctx, ins.rows[0]!.id, mensaje).catch((err) =>
    logger.error({ err: (err as Error).message }, 'alerts: notificacion falló'),
  );
}

async function runCycle(): Promise<void> {
  let client: Awaited<ReturnType<typeof getClient>> | null = null;
  try {
    client = await getClient();
    const result = await client.query<Alerta>(
      `SELECT a.id, a.nombre, a.empresa_id, a.sub_empresa_id, a.sitio_id, a.creado_por,
              a.variable_key, a.condicion, a.umbral_bajo, a.umbral_alto,
              a.severidad, a.cooldown_minutos, a.dias_activos,
              s.id_serial, s.descripcion AS sitio_desc
       FROM alertas a
       JOIN sitio s ON s.id = a.sitio_id
       WHERE a.activa = TRUE`,
    );
    for (const alerta of result.rows) {
      await evaluarAlerta(client, alerta).catch((err) =>
        logger.error(
          { err: (err as Error).message, alertaId: alerta.id },
          'alerts: error evaluando alerta',
        ),
      );
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'alerts: error en ciclo');
  } finally {
    if (client) client.release();
  }
}

export function startAlertsWorker(): void {
  if (intervalHandle) return;
  if (!config.workers.alerts) {
    logger.info('Alerts worker deshabilitado (ENABLE_ALERTS_WORKER=false).');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Alerts worker iniciado');
  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopAlertsWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Alerts worker detenido');
}
