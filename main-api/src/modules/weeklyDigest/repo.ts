/**
 * Las dos consultas del resumen semanal: qué alertas siguen abiertas y quién
 * pidió recibirlo.
 *
 * El alcance de cada sitio (`empresa_id`, `sub_empresa_id`) viene de `sitio` y
 * no de `alertas_eventos`: el evento guarda una copia de esos campos al
 * dispararse, y si el sitio cambia de división después, la copia queda vieja.
 * Quién puede ver qué se decide con el estado actual del sitio.
 */
import { query } from '../../config/dbHelpers';
import { logger } from '../../config/logger';
import type { SiteScope, UserTipo } from '../../shared/permissions';

export interface AlertaAbiertaRaw {
  id: number;
  sitio_id: string;
  severidad: string;
  mensaje: string;
  valor_texto: string | null;
  valor_detectado: string | null;
  /** En realidad `COALESCE(episodio_desde, triggered_at)`: si el episodio viene
   * de un escalamiento (dga_atrasado), esto es el inicio del incidente y no el
   * momento del último tier. */
  triggered_at: string;
  repeticiones: number;
  normalizada_at: string | null;
  reconocida_at: string | null;
  alerta_nombre: string;
  condicion: string;
  sitio_desc: string | null;
  tipo_sitio: string | null;
  empresa_id: string;
  sub_empresa_id: string | null;
  empresa_nombre: string | null;
  sub_empresa_nombre: string | null;
  obra_dga: string | null;
}

export interface Suscriptor extends SiteScope {
  id: string;
  email: string;
  nombre: string;
  apellido: string | null;
  /**
   * Se tipa como `UserTipo` aunque la columna sea un VARCHAR libre: un valor
   * que no esté en la lista cae en el `return false` final de `canReadSite`, o
   * sea, no ve ningún sitio. Es el default correcto.
   *
   * Un suscriptor SuperAdmin (equipo Emeltec) recibe el resumen de TODOS los
   * clientes en un solo correo, que es justamente lo que se pidió.
   */
  tipo: UserTipo;
}

/**
 * Episodios abiertos (`resuelta = FALSE`), de todos los clientes. El filtro por
 * usuario se hace después, en el worker, con `canReadSite`: la matriz de roles
 * ya está escrita dos veces (JS y TS) y no hace falta una tercera copia en SQL.
 *
 * Son pocas filas —un episodio por regla en falla, no uno por repetición— así
 * que traerlas todas y filtrar en memoria es más barato que una query por
 * destinatario.
 */
export async function getAlertasAbiertas(): Promise<AlertaAbiertaRaw[]> {
  const r = await query<AlertaAbiertaRaw>(
    `SELECT e.id,
            e.sitio_id,
            e.severidad,
            e.mensaje,
            e.valor_texto,
            e.valor_detectado::text AS valor_detectado,
            COALESCE(e.episodio_desde, e.triggered_at) AS triggered_at,
            COALESCE(e.repeticiones, 0) AS repeticiones,
            e.normalizada_at,
            e.reconocida_at,
            a.nombre    AS alerta_nombre,
            a.condicion,
            s.descripcion AS sitio_desc,
            s.tipo_sitio,
            s.empresa_id,
            s.sub_empresa_id,
            emp.nombre AS empresa_nombre,
            se.nombre  AS sub_empresa_nombre,
            pc.obra_dga
       FROM alertas_eventos e
       JOIN alertas a  ON a.id = e.alerta_id
       JOIN sitio   s  ON s.id = e.sitio_id
       LEFT JOIN empresa      emp ON emp.id = s.empresa_id
       LEFT JOIN sub_empresa  se  ON se.id  = s.sub_empresa_id
       LEFT JOIN pozo_config  pc  ON pc.sitio_id = s.id
      WHERE e.resuelta = FALSE
      ORDER BY COALESCE(e.episodio_desde, e.triggered_at) ASC`,
    [],
    { name: 'weekly_digest__abiertas' },
  );
  return r.rows;
}

/**
 * Suscriptores activos. Fail-CLOSED a propósito, al revés que la config: si la
 * columna no existe todavía (migración sin aplicar) o la query falla, nadie
 * recibe el correo. Equivocarse mandándole un correo de más a un cliente es
 * peor que saltarse una semana.
 */
export async function getSuscriptores(): Promise<Suscriptor[]> {
  try {
    const r = await query<Suscriptor>(
      `SELECT id, email, nombre, apellido, tipo, empresa_id, sub_empresa_id
         FROM usuario
        WHERE recibe_resumen_semanal = TRUE
          AND COALESCE(activo, TRUE)
          AND email IS NOT NULL
        ORDER BY email ASC`,
      [],
      { name: 'weekly_digest__suscriptores' },
    );
    return r.rows;
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      'weeklyDigest: no se pudo leer la lista de suscriptores → no se envía nada',
    );
    return [];
  }
}
