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
import type { RegMap } from '../sites/types';
import { siteUrl } from '../../utils/siteUrl';
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
  /** "Empresa · Sub-empresa · Sitio · Obra DGA": lo que el operador reconoce. */
  sitio_etiqueta?: string;
  /** Detalle del sitio en el frontend, con la pestaña de alertas abierta. */
  sitio_url?: string;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../services/emailService.js') as {
  sendAlertEmail: (to: string, name: string, msg: string, alerta: AlertRegla) => Promise<void>;
};
const { sendAlertEmail } = emailMod;

// Misma matemática que el dashboard (fuente única, CommonJS). El umbral de una
// regla se compara contra el valor transformado, no contra el crudo.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const transformMod = require('../../utils/mappingTransform.js') as {
  applyMappingTransform: (input: {
    rawData: Record<string, unknown>;
    mapping: RegMap;
    pozoConfig: unknown;
  }) => unknown;
  normalizeTransform: (value: unknown) => string;
};
const { applyMappingTransform, normalizeTransform } = transformMod;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const heartbeatMod = require('../../services/heartbeat.js') as { beat: (name: string) => void };
const { beat } = heartbeatMod;

const POLL_INTERVAL_MS = Number(process.env.ALERT_POLL_MS ?? 60_000);

/** Default espejo del de appConfig, para tests que mockean `config` sin `alertas`. */
const GUARDIA_EMELTEC_DEFAULT = ['druiz@emeltec.cl', 'nlira@emeltec.cl'];

function guardiaEmeltec(): string[] {
  const lista = (config as { alertas?: { emeltecEmails?: string[] } }).alertas?.emeltecEmails;
  return Array.isArray(lista) && lista.length > 0 ? lista : GUARDIA_EMELTEC_DEFAULT;
}
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
    | 'consumo_diario'
    | string;
  umbral_bajo: number | null;
  umbral_alto: number | null;
  severidad: string;
  cooldown_minutos: number;
  dias_activos: string[] | null;
  /** Usuarios que reciben el correo. Vacío = comportamiento histórico (el creador). */
  notificar_user_ids?: string[] | null;
  /** Además avisa a todos los SuperAdmin (equipo Emeltec). Default histórico: sí. */
  notificar_superadmins?: boolean | null;
  id_serial: string;
  sitio_desc: string;
  tipo_sitio?: string | null;
  empresa_nombre?: string | null;
  sub_empresa_nombre?: string | null;
  obra_dga?: string | null;
}

/**
 * Cómo se nombra el sitio en mensajes y correos: "CCU · Quilicura · Pozo 10 ·
 * OB-1306-98". El serial del equipo (151.20.47.22) no le dice nada a un
 * operador; va aparte, en la tabla técnica del correo. La sub-empresa se omite
 * cuando repite el nombre de la empresa.
 */
export function etiquetaSitio(alerta: {
  sitio_desc?: string | null;
  sitio_id: string;
  empresa_nombre?: string | null;
  sub_empresa_nombre?: string | null;
  obra_dga?: string | null;
}): string {
  const empresa = alerta.empresa_nombre?.trim() || '';
  const sub = alerta.sub_empresa_nombre?.trim() || '';
  const partes = [
    empresa,
    sub && sub.toLowerCase() !== empresa.toLowerCase() ? sub : '',
    alerta.sitio_desc?.trim() || alerta.sitio_id,
    alerta.obra_dga?.trim() || '',
  ].filter(Boolean);
  return partes.join(' · ');
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
      return 'sin comprobante SNIA hace más de 24h (escala a 48h y 72h)';
    case 'sobre_derecho_dga':
      return `el caudal supera el derecho DGA (límite ${alerta.umbral_bajo} L/s con tolerancia)`;
    case 'dga_slots_fallidos':
      return 'tiene slots DGA en estado fallido';
    case 'review_queue_acumulacion':
      return `la cola de revisión DGA superó el umbral de ${alerta.umbral_bajo} slots`;
    case 'consumo_diario':
      return `el consumo del día debe superar ${alerta.umbral_bajo}`;
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

export function buildMensaje(alerta: Alerta, valor: number | null): string {
  const sitio = etiquetaSitio(alerta);
  const severidad = alerta.severidad.toUpperCase();
  if (alerta.condicion === 'sin_datos') {
    return `[${severidad}] Sin datos en ${sitio}. El equipo no reporta información hace más de ${alerta.cooldown_minutos} minutos.`;
  }
  if (alerta.condicion === 'dga_slots_fallidos') {
    return `[${severidad}] ${sitio}. ${valor ?? 0} slot(s) DGA en estado fallido requieren intervención.`;
  }
  if (alerta.condicion === 'review_queue_acumulacion') {
    return `[${severidad}] ${sitio}. Cola de revisión DGA: ${valor ?? 0} slots en revisión (umbral ${alerta.umbral_bajo}).`;
  }
  if (alerta.condicion === 'sobre_derecho_dga') {
    return `[${severidad}] ${sitio}. Caudal ${formatValor(valor)} L/s sobre el derecho DGA: límite ${alerta.umbral_bajo} L/s (derecho más tolerancia).`;
  }
  return `[${severidad}] ${sitio}. Variable ${alerta.variable_key}: valor detectado ${formatValor(valor)}. Regla: ${formatCondicion(alerta)}.`;
}

async function notificarUsuarios(
  alerta: Alerta & { valor_detectado: string; condicion_texto: string },
  eventoId: string,
  mensaje: string,
): Promise<void> {
  // Destinatarios: los elegidos en la regla, más el equipo Emeltec si la regla
  // lo pide. Con la lista vacía se conserva el comportamiento histórico (avisar
  // al creador), así que una regla anterior a esta opción sigue igual.
  const elegidos = Array.isArray(alerta.notificar_user_ids)
    ? alerta.notificar_user_ids.filter((id) => typeof id === 'string' && id.length > 0)
    : [];
  // "Avisar al equipo Emeltec" no es todos los SuperAdmin: es la guardia de
  // alertas (ALERT_EMELTEC_EMAILS). Sigue exigiendo tipo SuperAdmin para que
  // un correo mal escrito en la env no le mande alertas a un cliente.
  const avisarSuperadmins = alerta.notificar_superadmins !== false;
  const guardia = guardiaEmeltec();
  const usuarios = await query<{
    id: string;
    email: string;
    nombre: string;
    apellido: string | null;
  }>(
    `SELECT DISTINCT id, email, nombre, apellido FROM usuario
     WHERE COALESCE(activo, TRUE)
       AND (
         ($2::boolean AND tipo = 'SuperAdmin' AND lower(email) = ANY($4::text[]))
         OR id = ANY($3::text[])
         OR (cardinality($3::text[]) = 0 AND id = $1)
       )`,
    [alerta.creado_por, avisarSuperadmins, elegidos, guardia],
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
  // La referencia es el ÚLTIMO SLOT CON COMPROBANTE SNIA (dato_dga.comprobante),
  // no `dga_last_run_at`: ese campo lo marca el fill cada vez que CALCULA un
  // slot, aunque el envío a SNIA lleve días fallando. Con la base anterior un
  // pozo con 3 días de envíos rechazados o en timeout figuraba "al día".
  // Config DGA del sitio desde pozo_config (dga_user fue eliminado en 2026-05-17).
  const u = await client.query(
    `SELECT pc.dga_periodicidad                       AS periodicidad,
            (SELECT MAX(d.ts) FROM dato_dga d
              WHERE d.site_id = pc.sitio_id
                AND d.comprobante IS NOT NULL)        AS ultimo_comprobante_ts,
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
        ultimo_comprobante_ts: string | Date | null;
        fecha_inicio: string;
        hora_inicio: string;
      }
    | undefined;
  if (!dgaUser) return; // sitio sin DGA configurado

  const stepMs = periodMsForDga(dgaUser.periodicidad);
  // Sin ningún comprobante todavía, la referencia es el inicio configurado del
  // reporte: un pozo que nunca logró enviar también tiene que alertar.
  const baseMs = dgaUser.ultimo_comprobante_ts
    ? new Date(dgaUser.ultimo_comprobante_ts).getTime()
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
          `Reporte DGA al día en ${alerta.sitio_desc ?? alerta.sitio_id}: SNIA volvió a entregar comprobante.`,
        ],
      );
    }
    return;
  }

  const curRank = SEV_RANK[tierSev] ?? 0;
  if (curRank <= lastRank) return; // ya notificada esta o mayor

  const sitio = alerta.sitio_desc ?? alerta.sitio_id;
  const lagTexto = formatLagHorasMinutos(lagMs);
  const ultimo = dgaUser.ultimo_comprobante_ts
    ? `Último comprobante SNIA: slot ${new Date(dgaUser.ultimo_comprobante_ts).toISOString().replace('T', ' ').slice(0, 16)} UTC.`
    : 'Nunca se ha recibido un comprobante SNIA para este pozo.';
  const mensaje = `[${tierSev.toUpperCase()}] Reporte DGA sin comprobante en ${sitio} hace ${lagTexto}. ${ultimo}`;
  const ctx = {
    ...alerta,
    severidad: tierSev,
    valor_detectado: lagTexto,
    condicion_texto: `sin comprobante SNIA hace más de ${DGA_TIER_H[tierSev]}h`,
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
 * Evalúa la condición `dga_slots_fallidos`.
 * Cuenta slots dato_dga en estado 'fallido' para el sitio. Si n >= 1, el veredicto
 * pasa por `debeNotificar` igual que el resto de condiciones. (ADR-6)
 *
 * Un slot fallido no se arregla solo: es la condición sticky por excelencia, así
 * que sin la agrupación de repeticiones generaba un correo por cooldown de forma
 * indefinida. Reconocer el evento corta el aviso; que el slot se recupere lo rearma.
 *
 * Guard W-1: si pozo_config.dga_activo=FALSE (o no existe config), la condición se
 * considera no cumplida — evita falsos positivos por datos residuales en dato_dga
 * luego de que el operador desactiva DGA para el sitio, y de paso rearma el evento
 * reconocido en vez de dejarlo abierto para siempre.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluarAlertaDgaSlotsFallidos(client: any, alerta: Alerta): Promise<void> {
  // El count queda en esta variable para reusarlo en el mensaje: debeNotificar
  // invoca el evaluador a lo más una vez por ciclo.
  let n = 0;
  const hayFallidos = async (): Promise<boolean> => {
    // Guard W-1: verificar que DGA sigue activo para el sitio antes de contar.
    // Mismo patrón que evaluarAlertaDgaAtrasado (ADR-1).
    const cfg = (await client.query(
      `SELECT 1 FROM pozo_config
        WHERE sitio_id = $1 AND dga_activo = TRUE
        LIMIT 1`,
      [alerta.sitio_id],
    )) as { rows: unknown[] };
    if (cfg.rows.length === 0) return false; // DGA desactivado o sin config

    const r = (await client.query(
      `SELECT COUNT(*)::int AS n FROM dato_dga
        WHERE site_id = $1 AND estatus = 'fallido'`,
      [alerta.sitio_id],
    )) as { rows: Array<{ n: number }> };
    n = r.rows[0]?.n ?? 0;
    return n > 0;
  };

  if (!(await debeNotificar(client, alerta, hayFallidos))) return;

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
 * Cuenta slots dato_dga en estado 'requires_review'. Si n > umbral_bajo (N), el
 * veredicto pasa por `debeNotificar` igual que el resto de condiciones.
 * (ADR-5, ADR-6)
 *
 * La cola de revisión tampoco se vacía sola: un backlog por encima del umbral
 * mantiene la condición cumplida indefinidamente, y antes eso significaba un
 * correo por cooldown hasta que alguien vaciara la cola.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluarAlertaReviewQueue(client: any, alerta: Alerta): Promise<void> {
  // Guard de misconfiguración: umbral_bajo debe ser un número positivo.
  // Se copia a un local porque el evaluador es un closure y TS no arrastra el
  // narrowing de una propiedad mutable hasta dentro.
  const umbral = alerta.umbral_bajo;
  if (umbral === null || umbral === undefined || umbral <= 0) {
    logger.warn(
      { alertaId: alerta.id, umbral_bajo: alerta.umbral_bajo },
      'alerts: review_queue_acumulacion sin umbral_bajo válido — alerta mal configurada',
    );
    return;
  }

  // El count queda en esta variable para reusarlo en el mensaje: debeNotificar
  // invoca el evaluador a lo más una vez por ciclo.
  let n = 0;
  const superaUmbral = async (): Promise<boolean> => {
    const r = (await client.query(
      `SELECT COUNT(*)::int AS n FROM dato_dga
        WHERE site_id = $1 AND estatus = 'requires_review'`,
      [alerta.sitio_id],
    )) as { rows: Array<{ n: number }> };
    n = r.rows[0]?.n ?? 0;
    return n > umbral;
  };

  if (!(await debeNotificar(client, alerta, superaUmbral))) return;

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
    logger.error(
      { err: (err as Error).message },
      'alerts: notificacion review_queue_acumulacion falló',
    ),
  );
}

/**
 * Consumo del día = DELTA del totalizador dentro del día calendario chileno,
 * NO el valor acumulado del contador.
 *
 * Reusa `computeDailyDeltasForVariable` (modules/contadores), que ya:
 *   - aplica la transformación del reg_map → el delta viene en unidades de
 *     ingeniería (m³), así que `umbral_bajo` NO es un valor crudo del payload
 *     como en `mayor_que`;
 *   - maneja los resets del contador (overflow uint32, reemplazo de sensor);
 *   - descarta payloads Modbus corruptos que llegan en 0.
 *
 * Se evalúa contra el día EN CURSO (acumulado parcial), para poder avisar
 * durante el evento y no al día siguiente.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluarAlertaConsumoDiario(client: any, alerta: Alerta): Promise<void> {
  if (alerta.umbral_bajo === null || alerta.umbral_bajo === undefined) return;
  if (!alerta.id_serial) return;

  const consumo = await getConsumoDiarioActual(client, alerta);
  if (!consumo || consumo.delta === null) return;

  // El veredicto pasa por debeNotificar para que aplique lo mismo que al resto
  // de condiciones: agrupar repeticiones si ya se dio por conocida, y rearmar
  // cuando el consumo del dia vuelve a estar bajo el umbral.
  const dispara = consumo.delta > alerta.umbral_bajo;
  if (!(await debeNotificar(client, alerta, () => dispara))) return;

  const sitio = alerta.sitio_desc ?? alerta.sitio_id;
  const severidad = alerta.severidad.toUpperCase();
  const unidad = consumo.unidad ? ` ${consumo.unidad}` : '';
  const deltaTexto = formatConsumo(consumo.delta);
  const mensaje =
    `[${severidad}] ${sitio}. Consumo del día ${consumo.diaIso}: ${deltaTexto}${unidad} ` +
    `(umbral ${alerta.umbral_bajo}${unidad}). Variable ${alerta.variable_key}.`;
  const ctx = {
    ...alerta,
    valor_detectado: `${deltaTexto}${unidad}`,
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
      consumo.delta,
      `${deltaTexto}${unidad}`,
      mensaje,
      alerta.severidad,
    ],
  )) as { rows: Array<{ id: string }> };
  notificarUsuarios(ctx, ins.rows[0]!.id, mensaje).catch((err) =>
    logger.error({ err: (err as Error).message }, 'alerts: notificacion consumo_diario falló'),
  );
}

function formatConsumo(valor: number): string {
  return (Math.round(valor * 100) / 100).toString();
}

/**
 * Cache del delta del día en curso por (sitio, variable). Sin esto, cada ciclo
 * del worker (60s) reescanearía todas las lecturas del día por alerta — el
 * cooldown no protege, porque solo aplica DESPUÉS de que la alerta disparó.
 * Un totalizador avanza lento: 5 min de staleness no cambia la decisión.
 */
const CONSUMO_CACHE_TTL_MS = Number(process.env.ALERT_CONSUMO_CACHE_MS ?? 5 * 60 * 1000);
const consumoCache = new Map<
  string,
  { at: number; diaIso: string; delta: number | null; unidad: string | null }
>();

interface ConsumoDiario {
  diaIso: string;
  delta: number | null;
  unidad: string | null;
}

/**
 * Carga diferida de `modules/contadores`: ese módulo inicializa el cliente
 * Redis al importarse, y las demás condiciones de alerta no lo necesitan.
 * Importarlo arriba obligaba a todo el worker (y a sus tests) a arrastrar esa
 * dependencia.
 */
async function contadoresService() {
  // La extensión .js es obligatoria: un import() dinámico se resuelve como
  // ESM genuino bajo moduleResolution node16, a diferencia de los imports
  // estáticos de este archivo, que se compilan a require.
  return import('../contadores/service.js');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getConsumoDiarioActual(client: any, alerta: Alerta): Promise<ConsumoDiario | null> {
  const { computeDailyDeltasForVariable, getDayRangeChile } = await contadoresService();
  const { start, end, diaIso } = getDayRangeChile(new Date());
  const cacheKey = `${alerta.sitio_id}:${alerta.variable_key}`;
  const hit = consumoCache.get(cacheKey);
  if (hit && hit.diaIso === diaIso && Date.now() - hit.at < CONSUMO_CACHE_TTL_MS) {
    return { diaIso, delta: hit.delta, unidad: hit.unidad };
  }

  // La alerta guarda la clave cruda del payload (`d1`); el cálculo de delta
  // necesita el mapping completo para saber cómo transformarla.
  const mapRes = (await client.query(
    `SELECT id, sitio_id, alias, d1, d2, tipo_dato, unidad, rol_dashboard,
            transformacion, parametros
       FROM reg_map
      WHERE sitio_id = $1 AND d1 = $2
      LIMIT 1`,
    [alerta.sitio_id, alerta.variable_key],
  )) as { rows: RegMap[] };
  const mapping = mapRes.rows[0];
  if (!mapping) {
    logger.warn(
      { alerta_id: alerta.id, sitio_id: alerta.sitio_id, variable_key: alerta.variable_key },
      'alerts: consumo_diario sin mapping en reg_map — regla inevaluable',
    );
    return null;
  }

  const siteRes = (await client.query(`SELECT tipo_sitio FROM sitio WHERE id = $1`, [
    alerta.sitio_id,
  ])) as { rows: Array<{ tipo_sitio: string | null }> };
  let pozoConfig = null;
  if (siteRes.rows[0]?.tipo_sitio === 'pozo') {
    const { getPozoConfigBySiteId } = await import('../sites/repo.js');
    pozoConfig = await getPozoConfigBySiteId(alerta.sitio_id);
  }

  const deltasByDay = await computeDailyDeltasForVariable({
    idSerial: alerta.id_serial!,
    mapping,
    pozoConfig,
    start,
    end,
  });
  const delta = deltasByDay.get(diaIso)?.delta ?? null;
  const unidad = mapping.unidad ?? null;
  consumoCache.set(cacheKey, { at: Date.now(), diaIso, delta, unidad });
  return { diaIso, delta, unidad };
}

/**
 * Decide si corresponde crear un evento NUEVO (y por lo tanto notificar) para
 * esta alerta. `evaluar` responde si la condición se cumple en este ciclo, y se
 * invoca de forma diferida: cuando el cooldown ya corta el ciclo no hace falta
 * consultarla, y las condiciones DGA la resuelven con un COUNT sobre `dato_dga`
 * que no queremos pagar cada 60s (ADR-6a).
 *
 * Reconocer un evento pasa a significar "ya lo sé": mientras siga abierto y
 * reconocido, las repeticiones se agrupan en él en vez de generar un evento y
 * un correo por cada cooldown. Antes el cooldown solo miraba `triggered_at`
 * sin importar el estado, así que una condición que no se normaliza sola
 * (un totalizador acumulado, por ejemplo) producía un aviso cada 5 minutos
 * indefinidamente.
 *
 * Rearme: si la condición se normaliza y el evento estaba reconocido, se
 * resuelve solo. Así la próxima vez que ocurra vuelve a avisar de verdad. Un
 * evento NO reconocido no se auto-resuelve: alguien tiene que verlo.
 *
 * @returns true si el llamador debe insertar el evento.
 */
async function debeNotificar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  alerta: Alerta,
  evaluar: () => boolean | Promise<boolean>,
): Promise<boolean> {
  const abiertoRes = (await client.query(
    `SELECT id, reconocida_at FROM alertas_eventos
      WHERE alerta_id = $1 AND resuelta = FALSE
      ORDER BY triggered_at DESC LIMIT 1`,
    [alerta.id],
  )) as { rows: Array<{ id: string; reconocida_at: string | null }> };
  const abierto = abiertoRes.rows[0];

  // Evento reconocido: no hay correo posible en este ciclo, pero sí hay que
  // saber si la condición sigue activa para elegir entre agrupar la repetición
  // y rearmar. El cooldown no aplica acá.
  if (abierto?.reconocida_at) {
    if (await evaluar()) {
      await client.query(
        `UPDATE alertas_eventos
          SET repeticiones = repeticiones + 1, ultima_repeticion_at = NOW()
        WHERE id = $1`,
        [abierto.id],
      );
      return false;
    }
    await client.query(
      `UPDATE alertas_eventos SET resuelta = TRUE, resuelta_at = NOW() WHERE id = $1`,
      [abierto.id],
    );
    logger.info(
      { alertaId: alerta.id, eventoId: abierto.id },
      'alerts: condicion normalizada, evento reconocido se rearma',
    );
    return false;
  }

  // Sin reconocer: rige el cooldown normal para no spamear al operador que
  // todavía no ha mirado la bandeja. Un evento sin reconocer tampoco se
  // auto-resuelve, así que no hace falta evaluar para decidir el rearme.
  const cool = await client.query(
    `SELECT 1 FROM alertas_eventos
      WHERE alerta_id = $1 AND triggered_at > NOW() - ($2 || ' minutes')::INTERVAL
      LIMIT 1`,
    [alerta.id, alerta.cooldown_minutos],
  );
  if (cool.rows.length > 0) return false;

  return evaluar();
}

/**
 * Valor contra el que se compara el umbral: el MISMO que muestra el dashboard.
 *
 * Si la variable está en el reg_map del sitio, el crudo pasa por su
 * transformación (factor/offset, IEEE754 de dos registros, uint32, nivel
 * freático…) y el umbral se escribe en la unidad del reg_map. Antes se
 * comparaba `equipo.data[variable_key]` sin transformar: con un factor 0,1 el
 * umbral iba multiplicado por 10, y con un float de dos registros no podía
 * calzar nunca (la palabra alta de un IEEE754 no significa nada sola).
 *
 * Sin mapeo se compara el crudo, como siempre. Si la transformación falla
 * (registro que no llegó, ancho de signo mal configurado) no se evalúa: es
 * exactamente lo que el dashboard marca como `ok: false`.
 */
async function valorEvaluable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  alerta: Alerta,
  data: Record<string, unknown>,
): Promise<{ valorNum: number; valorTexto: string } | null> {
  const mapRes = (await client.query(
    `SELECT id, sitio_id, alias, d1, d2, tipo_dato, unidad, rol_dashboard,
            transformacion, parametros
       FROM reg_map
      WHERE sitio_id = $1 AND d1 = $2
      ORDER BY alias
      LIMIT 1`,
    [alerta.sitio_id, alerta.variable_key],
  )) as { rows: RegMap[] };
  const mapping = mapRes.rows[0];

  let valor: unknown = data[alerta.variable_key];
  if (mapping) {
    let pozoConfig: unknown = null;
    if (normalizeTransform(mapping.transformacion) === 'nivel_freatico') {
      const pc = (await client.query(`SELECT * FROM pozo_config WHERE sitio_id = $1 LIMIT 1`, [
        alerta.sitio_id,
      ])) as { rows: unknown[] };
      pozoConfig = pc.rows[0] ?? null;
    }
    try {
      valor = applyMappingTransform({ rawData: data, mapping, pozoConfig });
    } catch (err) {
      logger.debug(
        { alertaId: alerta.id, variable_key: alerta.variable_key, err: (err as Error).message },
        'alerts: la transformacion del reg_map fallo, lectura no evaluable',
      );
      return null;
    }
  }

  const valorNum = typeof valor === 'number' ? valor : parseFloat(String(valor));
  if (!Number.isFinite(valorNum)) return null;
  return { valorNum, valorTexto: String(valor) };
}

/**
 * Condición `sobre_derecho_dga`: el caudal instantáneo del pozo supera el
 * derecho de aprovechamiento cargado en `pozo_config` (`dga_caudal_max_lps`)
 * más la tolerancia configurada. No lleva umbral ni variable: el límite sale
 * del derecho y el caudal, del mapeo con rol `caudal` del reg_map, con la misma
 * transformación que el dashboard. Es la versión "en vivo" de la regla
 * `flow_exceeds_water_right` que la validación DGA aplica a cada slot.
 *
 * Sin derecho cargado no hay contra qué comparar: la regla no evalúa (y el
 * formulario lo avisa). Cargar el derecho es un prerrequisito, no un default.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function evaluarAlertaSobreDerecho(client: any, alerta: Alerta): Promise<void> {
  const cfg = (await client.query(
    `SELECT dga_caudal_max_lps, dga_caudal_tolerance_pct
       FROM pozo_config
      WHERE sitio_id = $1
      LIMIT 1`,
    [alerta.sitio_id],
  )) as { rows: Array<{ dga_caudal_max_lps: unknown; dga_caudal_tolerance_pct: unknown }> };
  const derecho = Number(cfg.rows[0]?.dga_caudal_max_lps);
  if (!Number.isFinite(derecho) || derecho <= 0) {
    logger.debug(
      { alertaId: alerta.id, sitio_id: alerta.sitio_id },
      'alerts: sobre_derecho_dga sin dga_caudal_max_lps cargado, no evaluable',
    );
    return;
  }
  const toleranciaPct = Number(cfg.rows[0]?.dga_caudal_tolerance_pct);
  const limite = derecho * (1 + (Number.isFinite(toleranciaPct) ? toleranciaPct : 0) / 100);

  const mapRes = (await client.query(
    `SELECT id, sitio_id, alias, d1, d2, tipo_dato, unidad, rol_dashboard,
            transformacion, parametros
       FROM reg_map
      WHERE sitio_id = $1 AND rol_dashboard = 'caudal'
      ORDER BY alias`,
    [alerta.sitio_id],
  )) as { rows: RegMap[] };
  if (mapRes.rows.length === 0) return;

  const latest = (await client.query(
    `SELECT data FROM equipo WHERE id_serial = $1 ORDER BY time DESC LIMIT 1`,
    [alerta.id_serial],
  )) as { rows: Array<{ data: Record<string, unknown> }> };
  const data = latest.rows[0]?.data;
  if (!data) return;

  // Si hay más de un mapeo con rol caudal (resto de un recambio de equipo), se
  // usa el primero que calcula: mismo criterio que el dashboard.
  let caudal: number | null = null;
  for (const mapping of mapRes.rows) {
    try {
      const v = Number(applyMappingTransform({ rawData: data, mapping, pozoConfig: null }));
      if (Number.isFinite(v)) {
        caudal = v;
        break;
      }
    } catch {
      // registro que no llegó o transformación mal configurada: probar el siguiente
    }
  }
  if (caudal === null) return;

  const limiteRedondeado = Math.round(limite * 100) / 100;
  const dispara = caudal > limite;
  if (await debeNotificar(client, alerta, () => dispara)) {
    // El límite viaja como umbral_bajo para que el mensaje y el correo lo muestren.
    await insertarEvento(
      client,
      { ...alerta, umbral_bajo: limiteRedondeado },
      Math.round(caudal * 100) / 100,
      `${caudal} L/s`,
    );
  }
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

  if (alerta.condicion === 'consumo_diario') {
    await evaluarAlertaConsumoDiario(client, alerta);
    return;
  }

  if (alerta.condicion === 'sobre_derecho_dga') {
    await evaluarAlertaSobreDerecho(client, alerta);
    return;
  }

  if (alerta.condicion === 'sin_datos') {
    // "Sin datos" se decide por `received_at` (cuándo llegó el paquete), no por
    // `time` (el reloj del equipo): los dataloggers de CCU han estado hasta 52
    // minutos atrasados y con `time` la alerta saltaba 8 minutos después del
    // último paquete recibido (S119, 04-09-2026). Pero filtrar solo por
    // received_at no deja a Timescale excluir chunks y descomprime los ~900 de
    // la tabla buscando el serial, lo que en frío supera el statement timeout.
    // Por eso se acota además por `time` con un margen de un día: cae en uno o
    // dos chunks vía idx_equipo_serial_time y tolera cualquier desfase de reloj
    // razonable.
    const r = await client.query(
      `SELECT time FROM equipo
       WHERE id_serial = $1
         AND time > NOW() - ($2 || ' minutes')::INTERVAL - INTERVAL '1 day'
         AND received_at > NOW() - ($2 || ' minutes')::INTERVAL
       LIMIT 1`,
      [alerta.id_serial, alerta.cooldown_minutos],
    );
    const sinDatos = r.rows.length === 0;
    if (await debeNotificar(client, alerta, () => sinDatos)) {
      await insertarEvento(client, alerta, null, null);
    }
    return;
  }

  const latest = (await client.query(
    `SELECT data FROM equipo WHERE id_serial = $1 ORDER BY time DESC LIMIT 1`,
    [alerta.id_serial],
  )) as { rows: Array<{ data: Record<string, unknown> }> };
  if (latest.rows.length === 0) return;
  const rawVal = latest.rows[0]!.data[alerta.variable_key];
  if (rawVal === undefined) return;
  const evaluable = await valorEvaluable(client, alerta, latest.rows[0]!.data);
  if (evaluable === null) return;
  const { valorNum, valorTexto } = evaluable;

  const dispara = evalCondicion(
    alerta.condicion,
    valorNum,
    alerta.umbral_bajo ?? 0,
    alerta.umbral_alto ?? 0,
  );
  if (await debeNotificar(client, alerta, () => dispara)) {
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
    sitio_etiqueta: etiquetaSitio(alerta),
    sitio_url: siteUrl(alerta.sitio_id, alerta.tipo_sitio, 'alertas'),
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
  // Latido para el monitor interno (health digest), igual que hacía el legado.
  beat('alertas');
  let client: Awaited<ReturnType<typeof getClient>> | null = null;
  try {
    client = await getClient();
    const result = await client.query<Alerta>(
      `SELECT a.id, a.nombre, a.empresa_id, a.sub_empresa_id, a.sitio_id, a.creado_por,
              a.variable_key, a.condicion, a.umbral_bajo, a.umbral_alto,
              a.severidad, a.cooldown_minutos, a.dias_activos,
              a.notificar_user_ids, a.notificar_superadmins,
              s.id_serial, s.descripcion AS sitio_desc, s.tipo_sitio,
              e.nombre AS empresa_nombre, se.nombre AS sub_empresa_nombre,
              pc.obra_dga
       FROM alertas a
       JOIN sitio s ON s.id = a.sitio_id
       LEFT JOIN empresa e ON e.id = s.empresa_id
       LEFT JOIN sub_empresa se ON se.id = s.sub_empresa_id
       LEFT JOIN pozo_config pc ON pc.sitio_id = s.id
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
