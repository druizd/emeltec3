/**
 * Consolidado de alertas por correo.
 *
 * Por qué existe: el worker mandaba un correo por evento y por destinatario, y
 * volvía a disparar cada `cooldown_minutos` mientras nadie reconociera el
 * evento en la plataforma. Seis pozos con problema = seis correos cada hora,
 * indefinidamente. Ahora las severidades no inmediatas quedan encoladas
 * (`alertas_eventos.notificado = FALSE`) y salen juntas en un solo correo por
 * destinatario, a las 08:00 y 18:00 de reloj de pared chileno.
 *
 * Zona horaria: acá se usa `America/Santiago` de verdad, NO el `Etc/GMT+4`
 * fijo del resto de la plataforma. El UTC-4 fijo existe para que el reporte DGA
 * sea coherente con la base; este correo, en cambio, se define por la hora a la
 * que el operador se sienta frente al computador, y con UTC-4 fijo en verano
 * llegaría a las 09:00 y 19:00 de pared (es exactamente el problema por el que
 * `healthDigest` tuvo que correr sus horas una hora hacia atrás el 06-09-2026).
 *
 * Idempotencia: cada slot enviado queda registrado en `alertas_digest_envios`.
 * La PK por slot es el candado — si el proceso muere después de reclamar el
 * slot, los eventos siguen en la cola y salen en el siguiente; lo que nunca
 * pasa es mandar el mismo consolidado dos veces.
 */
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';
import { siteUrl } from '../../utils/siteUrl';
import { destinatariosDeAlerta, nombreCompleto, type DestinatarioAlerta } from './destinatarios';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../services/emailService.js') as {
  sendAlertDigestEmail: (input: DigestEmail) => Promise<void>;
};

export type EnviarDigest = (input: DigestEmail) => Promise<void>;

/**
 * El envío entra como parámetro y no como import directo porque emailService es
 * CommonJS y lo carga `require()`: el loader de Node no pasa por vitest, así
 * que `vi.mock` no lo intercepta (mismo motivo por el que los controllers se
 * testean sustituyendo `require.cache`). Inyectarlo deja el test legible.
 */
const enviarPorDefecto: EnviarDigest = (input) => emailMod.sendAlertDigestEmail(input);

/** Hora de pared chilena, con horario de verano. Ver el comentario de cabecera. */
export const DIGEST_TZ = 'America/Santiago';

/**
 * Cuánto hacia atrás se mira un slot sin enviar. Cubre un reinicio del servicio
 * o una ventana de mantención corta; más allá de eso el consolidado atrasado ya no le
 * sirve a nadie y los eventos se van en el slot siguiente igual.
 */
const LOOKBACK_MS = 2 * 3_600_000;

/**
 * Tope de filas por sección en el correo. El primer consolidado después del
 * deploy arrastra todo el backlog de eventos abiertos: sin tope sería un correo
 * de cientos de filas que nadie lee. El resto se cuenta en una línea y se ve en
 * la plataforma.
 */
export const MAX_FILAS_POR_SECCION = 30;

const SEV_RANK: Record<string, number> = { critica: 4, alta: 3, media: 2, baja: 1 };

export interface EventoDigest {
  id: string;
  alerta_id: string;
  alerta_nombre: string;
  creado_por: string;
  notificar_user_ids: string[] | null;
  notificar_superadmins: boolean | null;
  sitio_id: string;
  sitio_desc: string | null;
  tipo_sitio: string | null;
  empresa_nombre: string | null;
  sub_empresa_nombre: string | null;
  obra_dga: string | null;
  variable_key: string;
  valor_texto: string | null;
  mensaje: string;
  severidad: string;
  triggered_at: string | Date;
  repeticiones: number;
  reconocida_at: string | Date | null;
  resuelta: boolean;
}

/** Una fila del correo, ya lista para el template (sin lógica de negocio). */
export interface FilaDigest {
  severidad: string;
  sitio: string;
  alerta: string;
  mensaje: string;
  valor: string | null;
  desde: string;
  repeticiones: number;
  reconocida: boolean;
  /** La condición ya se normalizó sola antes de que saliera este correo. */
  normalizada: boolean;
  url: string;
}

export interface DigestEmail {
  to: string;
  nombre: string;
  slotLabel: string;
  nuevas: FilaDigest[];
  reaviso: FilaDigest[];
  /** Cuántas filas quedaron fuera del tope, por sección. */
  omitidasNuevas: number;
  omitidasReaviso: number;
}

// ---------------------------------------------------------------- slots

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
 * Slots de consolidado ya cumplidos que caen dentro de la ventana de rescate,
 * del más antiguo al más reciente. Se miran hoy y ayer (hora de Chile) porque
 * un slot de las 18:00 sigue siendo "de ayer" a las 02:00 de la madrugada.
 */
export function slotsCumplidos(
  now: Date,
  horas: number[] = config.alertas?.digest?.hours ?? [8, 18],
  tz: string = DIGEST_TZ,
): Date[] {
  const dias = [new Date(now.getTime() - 24 * 3_600_000), now].map((d) => partesEnZona(d, tz));
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

/** "14/09/2026 08:00" — cómo se titula el correo. */
export function etiquetaSlot(slot: Date, tz: string = DIGEST_TZ): string {
  const p = partesEnZona(slot, tz);
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  return `${dd}/${mm}/${p.year} ${hh}:00`;
}

/** DD/MM/YYYY HH:MM, el formato de fecha de toda la plataforma. */
export function fechaChile(value: string | Date, tz: string = DIGEST_TZ): string {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return 'sin fecha';
  const p = partesEnZona(at, tz);
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  const mi = String(p.minute).padStart(2, '0');
  return `${dd}/${mm}/${p.year} ${hh}:${mi}`;
}

// ---------------------------------------------------------------- armado

/** "CCU · Quilicura · Pozo 10 · OB-1306-98": lo que el operador reconoce. */
export function etiquetaSitioEvento(ev: EventoDigest): string {
  const empresa = ev.empresa_nombre?.trim() || '';
  const sub = ev.sub_empresa_nombre?.trim() || '';
  return [
    empresa,
    sub && sub.toLowerCase() !== empresa.toLowerCase() ? sub : '',
    ev.sitio_desc?.trim() || ev.sitio_id,
    ev.obra_dga?.trim() || '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function filaDe(ev: EventoDigest): FilaDigest {
  return {
    severidad: ev.severidad,
    sitio: etiquetaSitioEvento(ev),
    alerta: ev.alerta_nombre,
    mensaje: ev.mensaje,
    valor: ev.valor_texto,
    desde: fechaChile(ev.triggered_at),
    repeticiones: Number(ev.repeticiones ?? 0),
    reconocida: Boolean(ev.reconocida_at),
    // Una condición que dispara y se normaliza sola antes del consolidado
    // igual se informa —si no, nadie se entera de que pasó— pero diciendo que
    // ya pasó, para que no se vaya nadie a terreno por algo cerrado.
    normalizada: Boolean(ev.resuelta),
    url: siteUrl(ev.sitio_id, ev.tipo_sitio, 'alertas'),
  };
}

/** Más grave primero; a igual severidad, lo más antiguo primero. */
export function ordenarFilas(evs: EventoDigest[]): EventoDigest[] {
  return [...evs].sort((a, b) => {
    const rank = (SEV_RANK[b.severidad] ?? 0) - (SEV_RANK[a.severidad] ?? 0);
    if (rank !== 0) return rank;
    return new Date(a.triggered_at).getTime() - new Date(b.triggered_at).getTime();
  });
}

export interface Bandeja {
  usuario: DestinatarioAlerta;
  nuevas: EventoDigest[];
  reaviso: EventoDigest[];
}

/**
 * Reparte los eventos en una bandeja por destinatario. Los destinatarios se
 * resuelven una vez por REGLA, no por evento: un sitio con cinco eventos de la
 * misma alerta hacía cinco veces la misma consulta.
 */
export async function armarBandejas(
  nuevas: EventoDigest[],
  reaviso: EventoDigest[],
  resolver: (ev: EventoDigest) => Promise<DestinatarioAlerta[]> = (ev) => destinatariosDeAlerta(ev),
): Promise<Map<string, Bandeja>> {
  const cache = new Map<string, DestinatarioAlerta[]>();
  const bandejas = new Map<string, Bandeja>();

  const repartir = async (evs: EventoDigest[], seccion: 'nuevas' | 'reaviso') => {
    for (const ev of evs) {
      let destinatarios = cache.get(ev.alerta_id);
      if (!destinatarios) {
        destinatarios = await resolver(ev).catch((err) => {
          logger.error(
            { err: (err as Error).message, alertaId: ev.alerta_id },
            'alerts digest: no se pudieron resolver destinatarios',
          );
          return [] as DestinatarioAlerta[];
        });
        cache.set(ev.alerta_id, destinatarios);
      }
      for (const u of destinatarios) {
        const clave = u.email.toLowerCase();
        let bandeja = bandejas.get(clave);
        if (!bandeja) {
          bandeja = { usuario: u, nuevas: [], reaviso: [] };
          bandejas.set(clave, bandeja);
        }
        bandeja[seccion].push(ev);
      }
    }
  };

  await repartir(nuevas, 'nuevas');
  await repartir(reaviso, 'reaviso');
  return bandejas;
}

export function correoDeBandeja(bandeja: Bandeja, slotLabel: string): DigestEmail {
  const nuevas = ordenarFilas(bandeja.nuevas);
  const reaviso = ordenarFilas(bandeja.reaviso);
  return {
    to: bandeja.usuario.email,
    nombre: nombreCompleto(bandeja.usuario),
    slotLabel,
    nuevas: nuevas.slice(0, MAX_FILAS_POR_SECCION).map(filaDe),
    reaviso: reaviso.slice(0, MAX_FILAS_POR_SECCION).map(filaDe),
    omitidasNuevas: Math.max(0, nuevas.length - MAX_FILAS_POR_SECCION),
    omitidasReaviso: Math.max(0, reaviso.length - MAX_FILAS_POR_SECCION),
  };
}

// ---------------------------------------------------------------- ejecución

const SELECT_EVENTO = `
  SELECT ev.id, ev.alerta_id, ev.sitio_id, ev.variable_key, ev.valor_texto,
         ev.mensaje, ev.severidad, ev.triggered_at, ev.repeticiones, ev.reconocida_at,
         ev.resuelta,
         a.nombre AS alerta_nombre, a.creado_por,
         a.notificar_user_ids, a.notificar_superadmins,
         s.descripcion AS sitio_desc, s.tipo_sitio,
         e.nombre AS empresa_nombre, se.nombre AS sub_empresa_nombre,
         pc.obra_dga
    FROM alertas_eventos ev
    JOIN alertas a ON a.id = ev.alerta_id
    JOIN sitio s ON s.id = ev.sitio_id
    LEFT JOIN empresa e ON e.id = s.empresa_id
    LEFT JOIN sub_empresa se ON se.id = s.sub_empresa_id
    LEFT JOIN pozo_config pc ON pc.sitio_id = s.id`;

/**
 * Reclama el slot antes de mandar nada. Si otra réplica (o el ciclo anterior)
 * ya lo tomó, devuelve false y este ciclo no manda correo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reclamarSlot(client: any, slot: Date): Promise<boolean> {
  const r = (await client.query(
    `INSERT INTO alertas_digest_envios (slot_ts)
     VALUES ($1)
     ON CONFLICT (slot_ts) DO NOTHING
     RETURNING slot_ts`,
    [slot.toISOString()],
  )) as { rows: unknown[] };
  return r.rows.length > 0;
}

export interface ResumenConsolidado {
  nuevas: number;
  reaviso: number;
  destinatarios: number;
}

/**
 * Manda el consolidado de un slot. Devuelve el resumen de lo enviado.
 *
 * Marca los eventos como notificados SIEMPRE, aunque la regla no tuviera
 * destinatarios: si no, la cola crecería para siempre y el evento saldría en
 * todos los consolidados futuros.
 */
export async function enviarConsolidado(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  slot: Date,
  enviar: EnviarDigest = enviarPorDefecto,
): Promise<ResumenConsolidado> {
  const repeatHours = config.alertas?.digest?.repeatHours ?? 20;

  const nuevasRes = (await client.query(
    `${SELECT_EVENTO}
    WHERE ev.notificado = FALSE
    ORDER BY ev.triggered_at`,
  )) as { rows: EventoDigest[] };

  const reavisoRes = (await client.query(
    `${SELECT_EVENTO}
    WHERE ev.notificado = TRUE
      AND ev.resuelta = FALSE
      AND ev.notificado_at IS NOT NULL
      AND ev.notificado_at < NOW() - ($1 || ' hours')::INTERVAL
    ORDER BY ev.triggered_at`,
    [String(repeatHours)],
  )) as { rows: EventoDigest[] };

  const nuevas = nuevasRes.rows;
  const reaviso = reavisoRes.rows;

  if (nuevas.length === 0 && reaviso.length === 0) {
    logger.info({ slot: slot.toISOString() }, 'alerts digest: nada que consolidar');
    return { nuevas: 0, reaviso: 0, destinatarios: 0 };
  }

  const bandejas = await armarBandejas(nuevas, reaviso);
  const slotLabel = etiquetaSlot(slot);

  // Un envío por destinatario (no un `to` múltiple): así un rechazo de Resend
  // en una dirección no se lleva el consolidado del resto.
  for (const bandeja of bandejas.values()) {
    await enviar(correoDeBandeja(bandeja, slotLabel)).catch((err: unknown) =>
      logger.error(
        { err: (err as Error).message, to: bandeja.usuario.email },
        'alerts digest: fallo el envio del consolidado',
      ),
    );
  }

  if (nuevas.length > 0) {
    await client.query(
      `UPDATE alertas_eventos
          SET notificado = TRUE, notificado_at = NOW()
        WHERE id = ANY($1::int[])`,
      [nuevas.map((ev) => Number(ev.id))],
    );
  }
  if (reaviso.length > 0) {
    await client.query(
      `UPDATE alertas_eventos SET notificado_at = NOW() WHERE id = ANY($1::int[])`,
      [reaviso.map((ev) => Number(ev.id))],
    );
  }

  await client.query(
    `UPDATE alertas_digest_envios
        SET eventos_nuevos = $2, eventos_reaviso = $3, destinatarios = $4, enviado_at = NOW()
      WHERE slot_ts = $1`,
    [slot.toISOString(), nuevas.length, reaviso.length, bandejas.size],
  );

  logger.info(
    {
      slot: slot.toISOString(),
      nuevas: nuevas.length,
      reaviso: reaviso.length,
      destinatarios: bandejas.size,
    },
    'alerts digest: consolidado enviado',
  );
  return { nuevas: nuevas.length, reaviso: reaviso.length, destinatarios: bandejas.size };
}

/**
 * Punto de entrada del ciclo del worker: manda los slots cumplidos que todavía
 * no se enviaron. En la práctica es a lo más uno, pero la lista tolera un
 * reinicio que se haya comido el slot anterior.
 */
export async function procesarDigestPendiente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  now: Date = new Date(),
  enviar: EnviarDigest = enviarPorDefecto,
): Promise<void> {
  if (config.alertas?.digest?.enabled === false) return;
  for (const slot of slotsCumplidos(now)) {
    if (!(await reclamarSlot(client, slot))) continue;
    await enviarConsolidado(client, slot, enviar);
  }
}
