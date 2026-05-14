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

/**
 * Último `received_at` por sitio activo (excluyendo maletas).
 * Subquery por sitio aprovecha el índice (id_serial, time) de equipo.
 */
export async function getDataTransmissionLag(): Promise<DataLagRaw[]> {
  const r = await query<DataLagRaw>(
    `SELECT s.id AS site_id,
            s.descripcion,
            e.nombre AS empresa_nombre,
            s.id_serial,
            (SELECT MAX(received_at) FROM equipo WHERE id_serial = s.id_serial) AS last_received_at
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
 * Informantes DGA activos con datos crudos para que el worker compute
 * `expected_next` en JS según periodicidad.
 */
export async function getDgaUsersForMonitoring(): Promise<DgaUserRaw[]> {
  const r = await query<DgaUserRaw>(
    `SELECT u.id_dgauser::text AS id_dgauser,
            u.site_id,
            s.descripcion,
            e.nombre AS empresa_nombre,
            u.periodicidad,
            u.last_run_at,
            to_char(u.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            to_char(u.hora_inicio,  'HH24:MI:SS') AS hora_inicio
       FROM dga_user u
       JOIN sitio s ON s.id = u.site_id
       LEFT JOIN empresa e ON e.id = s.empresa_id
      WHERE u.activo = TRUE
        AND s.activo = TRUE
        AND s.tipo_sitio <> 'maleta'`,
    [],
    { name: 'health_digest__dga_users' },
  );
  return r.rows;
}
