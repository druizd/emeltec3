/**
 * Repositorio del worker de salud (healthDigest).
 *
 * Calcula lag de transmisión de datos y de reportes DGA por sitio. Excluye
 * sitios tipo `maleta` (pilotos) y sitios/dga_user inactivos.
 */
import { query } from '../../config/dbHelpers';

export interface DataLagRaw {
  site_id: string;
  descripcion: string;
  empresa_nombre: string | null;
  id_serial: string;
  last_received_at: string | null;
}

export interface DgaUserRaw {
  id_dgauser: string;
  site_id: string;
  descripcion: string;
  empresa_nombre: string | null;
  periodicidad: 'hora' | 'dia' | 'semana' | 'mes';
  last_run_at: string | null;
  fecha_inicio: string;
  hora_inicio: string;
}

/** Ventana de búsqueda del último dato. Ver `getDataTransmissionLag`. */
const LAG_WINDOW_DAYS = 30;

/**
 * Último `received_at` por sitio activo (excluyendo maletas).
 *
 * La subquery se acota a los últimos `LAG_WINDOW_DAYS` días por `time`, que es
 * la columna de particionamiento de la hypertable: sin ese filtro no hay
 * exclusión de chunks y el `MAX(received_at)` recorre TODO el historial de cada
 * equipo, una vez por sitio. El índice (id_serial, time) no salva la situación
 * porque el máximo se pide sobre `received_at`, que no está en él, así que
 * Postgres no puede resolverlo con un scan hacia atrás.
 *
 * En producción eso tardaba 26 s y moría contra DB_STATEMENT_TIMEOUT_MS, lo que
 * dejaba el botón "Enviar prueba" en 500 y habría hecho fallar cada ciclo del
 * worker (incidente 20-08-2026).
 *
 * La ventana no pierde información: el worker clasifica en t3/t6/t12 y trata
 * `last_received_at = null` como el peor tier. Un sitio sin datos hace 30 días
 * ya está en el peor tier con o sin fecha exacta.
 */
export async function getDataTransmissionLag(): Promise<DataLagRaw[]> {
  const r = await query<DataLagRaw>(
    `SELECT s.id AS site_id,
            s.descripcion,
            e.nombre AS empresa_nombre,
            s.id_serial,
            (SELECT MAX(received_at) FROM equipo
              WHERE id_serial = s.id_serial
                AND time > NOW() - INTERVAL '${LAG_WINDOW_DAYS} days') AS last_received_at
       FROM sitio s
       LEFT JOIN empresa e ON e.id = s.empresa_id
      WHERE s.activo = TRUE
        AND s.tipo_sitio <> 'maleta'
        AND s.id_serial IS NOT NULL`,
    [],
    { name: 'health_digest__data_lag' },
  );
  return r.rows;
}

/**
 * Sitios DGA activos con datos crudos para que el worker compute
 * `expected_next` en JS según periodicidad.
 *
 * Fuente: pozo_config (dga_user fue eliminado en migración 2026-05-17).
 * id_dgauser es un alias de sitio_id mantenido por compatibilidad con
 * DgaUserRaw y los consumidores de healthDigest/worker.ts (ADR-3).
 */
export async function getDgaUsersForMonitoring(): Promise<DgaUserRaw[]> {
  const r = await query<DgaUserRaw>(
    `SELECT pc.sitio_id                                AS id_dgauser,
            pc.sitio_id                                AS site_id,
            s.descripcion,
            e.nombre                                   AS empresa_nombre,
            pc.dga_periodicidad                        AS periodicidad,
            pc.dga_last_run_at                         AS last_run_at,
            to_char(pc.dga_fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            to_char(pc.dga_hora_inicio,  'HH24:MI:SS') AS hora_inicio
       FROM pozo_config pc
       JOIN sitio s   ON s.id = pc.sitio_id
       LEFT JOIN empresa e ON e.id = s.empresa_id
      WHERE pc.dga_activo = TRUE
        AND s.activo = TRUE
        AND s.tipo_sitio <> 'maleta'`,
    [],
    { name: 'health_digest__dga_users' },
  );
  return r.rows;
}
