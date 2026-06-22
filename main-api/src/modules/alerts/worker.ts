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
  condicion:
    | 'mayor_que'
    | 'menor_que'
    | 'igual_a'
    | 'fuera_rango'
    | 'sin_datos'
    | 'dga_atrasado'
    | 'dga_slots_fallidos'
    | 'review_queue_acumulacion'
    | string;
  umbral_bajo: number | null;
  umbral_alto: number | null;
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
    case 'dga_atrasado':
      return 'reporte DGA atrasado más de 24h (escala a 48h y 72h)';
    case 'dga_slots_fallidos':
      return 'tiene slots DGA en estado fallido';
    case 'review_queue_acumulacion':
      return `la cola de revisión DGA superó el umbral de ${alerta.umbral_bajo} slots`;
    default:
      return alerta.condicion;
  }
}

const SEV_RANK: Record<string, number> = { baja: 1, media: 2, alta: 3, critica: 4 };

const DGA_TIER_H = { media: 24, alta: 48, critica: 72 } as const;

function periodMsForDga(p: string): number {
  switch (p) {
    case 'hora':
      return 3_600_000;
    case 'dia':
      return 86_400_000;
    case 'semana':
      return 7 * 86_400_000;
    case 'mes':
      return 30 * 86_400_000;
    default:
      return 86_400_000;
  }
}

function severidadParaLagDgaH(lagHours: number): 'media' | 'alta' | 'critica' | null {
  if (lagHours >= DGA_TIER_H.critica) return 'critica';
  if (lagHours >= DGA_TIER_H.alta) return 'alta';
  if (lagHours >= DGA_TIER_H.media) return 'media';
  return null;
}

function formatLagHorasMinutos(lagMs: number): string {
  const totalMin = Math.max(0, Math.floor(lagMs / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function buildMensaje(alerta: Alerta, valor: number | null): string {
  const sitio = alerta.sitio_desc ?? alerta.sitio_id;
  const severidad = alerta.severidad.toUpperCase();
  if (alerta.condicion === 'sin_datos') {
    return `[${severidad}] Sin datos en ${sitio}. Equipo ${alerta.id_serial} no reporta informacion hace mas de ${alerta.cooldown_minutos} minutos.`;
  }
  if (alerta.condicion === 'dga_slots_fallidos') {
    return `[${severidad}] ${sitio}. ${valor ?? 0} slot(s) DGA en estado fallido requieren intervención.`;
  }
  if (alerta.condicion === 'review_queue_acumulacion') {
    return `[${severidad}] ${sitio}. Cola de revisión DGA: ${valor ?? 0} slots requires_review (umbral ${alerta.umbral_bajo}).`;
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
export async function evaluarAlertaDgaAtrasado(client: any, alerta: Alerta): Promise<void> {
  // Lookup config DGA del sitio desde pozo_config (dga_user fue eliminado en 2026-05-17).
  const u = await client.query(
    `SELECT pc.dga_periodicidad                       AS periodicidad,
            pc.dga_last_run_at                        AS last_run_at,
            to_char(pc.dga_fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            to_char(pc.dga_hora_inicio,  'HH24:MI:SS') AS hora_inicio
       FROM pozo_config pc
      WHERE pc.sitio_id = $1 AND pc.dga_activo = TRUE
      LIMIT 1`,
    [alerta.sitio_id],
  );
  const dgaUser = u.rows[0] as
    | {
        periodicidad: string;
        last_run_at: string | null;
        fecha_inicio: string;
        hora_inicio: string;
      }
    | undefined;
  if (!dgaUser) return; // sitio sin DGA configurado

  const stepMs = periodMsForDga(dgaUser.periodicidad);
  const baseMs = dgaUser.last_run_at
    ? new Date(dgaUser.last_run_at).getTime()
    : new Date(
        `${dgaUser.fecha_inicio}T${dgaUser.hora_inicio.length === 5 ? `${dgaUser.hora_inicio}:00` : dgaUser.hora_inicio}-04:00`,
      ).getTime();
  const expectedNextMs = baseMs + stepMs;
  const lagMs = Math.max(0, Date.now() - expectedNextMs);
  const lagH = lagMs / 3_600_000;
  const tierSev = severidadParaLagDgaH(lagH);

  // Última severidad notificada para esta alerta.
  const last = await client.query(
    `SELECT severidad FROM alertas_eventos
      WHERE alerta_id = $1
      ORDER BY triggered_at DESC LIMIT 1`,
    [alerta.id],
  );
  const lastSev = (last.rows[0]?.severidad as string | undefined) ?? null;
  const lastRank = lastSev ? (SEV_RANK[lastSev] ?? 0) : 0;

  if (tierSev === null) {
    // Recovered: si último era >= media, marca recovery silencioso.
    if (lastRank >= (SEV_RANK.media ?? 2)) {
      await client.query(
        `INSERT INTO alertas_eventos
           (alerta_id, empresa_id, sub_empresa_id, sitio_id, variable_key,
            valor_detectado, valor_texto, mensaje, severidad, notificado, resuelta)
         VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,'baja',TRUE,TRUE)`,
        [
          alerta.id,
          alerta.empresa_id,
          alerta.sub_empresa_id ?? null,
          alerta.sitio_id,
          alerta.variable_key,
          `Reporte DGA al día en ${alerta.sitio_desc ?? alerta.sitio_id}.`,
        ],
      );
    }
    return;
  }

  const curRank = SEV_RANK[tierSev] ?? 0;
  if (curRank <= lastRank) return; // ya notificada esta o mayor

  const sitio = alerta.sitio_desc ?? alerta.sitio_id;
  const lagTexto = formatLagHorasMinutos(lagMs);
  const mensaje = `[${tierSev.toUpperCase()}] Reporte DGA atrasado en ${sitio}. Sin reportar hace ${lagTexto}.`;
  const ctx = {
    ...alerta,
    severidad: tierSev,
    valor_detectado: lagTexto,
    condicion_texto: `reporte DGA atrasado más de ${DGA_TIER_H[tierSev]}h`,
  };
  const ins = (await client.query(
    `INSERT INTO alertas_eventos
       (alerta_id, empresa_id, sub_empresa_id, sitio_id, variable_key,
        valor_detectado, valor_texto, mensaje, severidad)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8)
     RETURNING id`,
    [
      alerta.id,
      alerta.empresa_id,
      alerta.sub_empresa_id ?? null,
      alerta.sitio_id,
      alerta.variable_key,
      lagTexto,
      mensaje,
      tierSev,
    ],
  )) as { rows: Array<{ id: string }> };
  notificarUsuarios(ctx, ins.rows[0]!.id, mensaje).catch((err) =>
    logger.error({ err: (err as Error).message }, 'alerts: notificacion DGA falló'),
  );
}

/**
 * Comprueba si ya existe un evento reciente dentro del cooldown para esta alerta.
 * Usado internamente por los evaluadores DGA sticky-state para evitar re-disparos
 * cada 60s (ADR-6a). Los evaluadores DGA hacen early-return antes del cooldown
 * genérico de evaluarAlerta(), por lo que deben gestionar su propia deduplicación.
 *
 * @returns true si hay un evento dentro del window de cooldown (→ caller debe retornar).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dentroDeCooldown(client: any, alerta: Alerta): Promise<boolean> {
  const r = await client.query(
    `SELECT triggered_at FROM alertas_eventos
     WHERE alerta_id = $1 AND triggered_at > NOW() - ($2 || ' minutes')::INTERVAL
     ORDER BY triggered_at DESC LIMIT 1`,
    [alerta.id, alerta.cooldown_minutos],
  );
  return (r as { rows: unknown[] }).rows.length > 0;
}

/**
 * Evalúa la condición `dga_slots_fallidos`.
 * Cuenta slots dato_dga en estado 'fallido' para el sitio. Si n >= 1 y el
 * cooldown no está activo, inserta alertas_eventos y notifica. (ADR-6)
 *
 * Guard W-1: si pozo_config.dga_activo=FALSE (o no existe config), el evaluador
 * sale temprano sin disparar alarma — evita falsos positivos por datos residuales
 * en dato_dga luego de que el operador desactiva DGA para el sitio.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluarAlertaDgaSlotsFallidos(client: any, alerta: Alerta): Promise<void> {
  if (await dentroDeCooldown(client, alerta)) return;

  // Guard W-1: verificar que DGA sigue activo para el sitio antes de contar.
  // Mismo patrón que evaluarAlertaDgaAtrasado (ADR-1).
  const cfg = (await client.query(
    `SELECT 1 FROM pozo_config
     WHERE sitio_id = $1 AND dga_activo = TRUE
     LIMIT 1`,
    [alerta.sitio_id],
  )) as { rows: unknown[] };
  if (cfg.rows.length === 0) return; // DGA desactivado o sin config — no disparar

  const r = (await client.query(
    `SELECT COUNT(*)::int AS n FROM dato_dga
     WHERE site_id = $1 AND estatus = 'fallido'`,
    [alerta.sitio_id],
  )) as { rows: Array<{ n: number }> };
  const n = r.rows[0]?.n ?? 0;
  if (n === 0) return;

  const sitio = alerta.sitio_desc ?? alerta.sitio_id;
  const severidad = alerta.severidad.toUpperCase();
  const mensaje = `[${severidad}] ${sitio}. ${n} slot(s) DGA en estado fallido requieren intervención.`;
  const ctx = {
    ...alerta,
    valor_detectado: String(n),
    condicion_texto: formatCondicion(alerta),
  };
  const ins = (await client.query(
    `INSERT INTO alertas_eventos
       (alerta_id, empresa_id, sub_empresa_id, sitio_id, variable_key,
        valor_detectado, valor_texto, mensaje, severidad)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8)
     RETURNING id`,
    [
      alerta.id,
      alerta.empresa_id,
      alerta.sub_empresa_id ?? null,
      alerta.sitio_id,
      alerta.variable_key,
      String(n),
      mensaje,
      alerta.severidad,
    ],
  )) as { rows: Array<{ id: string }> };
  notificarUsuarios(ctx, ins.rows[0]!.id, mensaje).catch((err) =>
    logger.error({ err: (err as Error).message }, 'alerts: notificacion dga_slots_fallidos falló'),
  );
}

/**
 * Evalúa la condición `review_queue_acumulacion`.
 * Cuenta slots dato_dga en estado 'requires_review'. Si n > umbral_bajo (N) y el
 * cooldown no está activo, inserta alertas_eventos y notifica. (ADR-5, ADR-6)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluarAlertaReviewQueue(client: any, alerta: Alerta): Promise<void> {
  // Guard de misconfiguración: umbral_bajo debe ser un número positivo.
  if (alerta.umbral_bajo === null || alerta.umbral_bajo === undefined || alerta.umbral_bajo <= 0) {
    logger.warn(
      { alertaId: alerta.id, umbral_bajo: alerta.umbral_bajo },
      'alerts: review_queue_acumulacion sin umbral_bajo válido — alerta mal configurada',
    );
    return;
  }

  if (await dentroDeCooldown(client, alerta)) return;

  const r = (await client.query(
    `SELECT COUNT(*)::int AS n FROM dato_dga
     WHERE site_id = $1 AND estatus = 'requires_review'`,
    [alerta.sitio_id],
  )) as { rows: Array<{ n: number }> };
  const n = r.rows[0]?.n ?? 0;
  if (n <= alerta.umbral_bajo) return;

  const sitio = alerta.sitio_desc ?? alerta.sitio_id;
  const severidad = alerta.severidad.toUpperCase();
  const mensaje = `[${severidad}] ${sitio}. Cola de revisión DGA: ${n} slots requires_review (umbral ${alerta.umbral_bajo}).`;
  const ctx = {
    ...alerta,
    valor_detectado: String(n),
    condicion_texto: formatCondicion(alerta),
  };
  const ins = (await client.query(
    `INSERT INTO alertas_eventos
       (alerta_id, empresa_id, sub_empresa_id, sitio_id, variable_key,
        valor_detectado, valor_texto, mensaje, severidad)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8)
     RETURNING id`,
    [
      alerta.id,
      alerta.empresa_id,
      alerta.sub_empresa_id ?? null,
      alerta.sitio_id,
      alerta.variable_key,
      String(n),
      mensaje,
      alerta.severidad,
    ],
  )) as { rows: Array<{ id: string }> };
  notificarUsuarios(ctx, ins.rows[0]!.id, mensaje).catch((err) =>
    logger.error({ err: (err as Error).message }, 'alerts: notificacion review_queue_acumulacion falló'),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluarAlerta(client: any, alerta: Alerta): Promise<void> {
  if (!estaActivoHoy(alerta)) return;

  if (alerta.condicion === 'dga_atrasado') {
    await evaluarAlertaDgaAtrasado(client, alerta);
    return;
  }

  if (alerta.condicion === 'dga_slots_fallidos') {
    await evaluarAlertaDgaSlotsFallidos(client, alerta);
    return;
  }

  if (alerta.condicion === 'review_queue_acumulacion') {
    await evaluarAlertaReviewQueue(client, alerta);
    return;
  }

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
    evalCondicion(alerta.condicion, valorNum, alerta.umbral_bajo ?? 0, alerta.umbral_alto ?? 0)
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
