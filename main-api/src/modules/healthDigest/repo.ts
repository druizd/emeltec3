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
