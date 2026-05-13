/**
 * Repositorio DGA: dga_user (config informante) + dato_dga (mediciones procesadas).
 */
import { query } from '../../config/dbHelpers';
import type { Periodicidad } from './schema';

export interface DgaUserRow {
  id_dgauser: string;
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  clave_informante: string;
  periodicidad: Periodicidad;
  fecha_inicio: string;
  hora_inicio: string;
  last_run_at: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface DatoDgaRow {
  id_dgauser: string;
  obra: string;
  ts: string;
  fecha: string;
  hora: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
}

const USER_COLS =
  'id_dgauser, site_id, nombre_informante, rut_informante, clave_informante, periodicidad, ' +
  "to_char(fecha_inicio,'YYYY-MM-DD') AS fecha_inicio, " +
  "to_char(hora_inicio,'HH24:MI:SS') AS hora_inicio, " +
  'last_run_at, activo, created_at, updated_at';

export async function insertDgaUser(input: {
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  clave_cifrada: string;
  periodicidad: Periodicidad;
  fecha_inicio: string;
  hora_inicio: string;
}): Promise<DgaUserRow> {
  const r = await query<DgaUserRow>(
    `INSERT INTO dga_user
       (site_id, nombre_informante, rut_informante, clave_informante,
        periodicidad, fecha_inicio, hora_inicio)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${USER_COLS}`,
    [
      input.site_id,
      input.nombre_informante,
      input.rut_informante,
      input.clave_cifrada,
      input.periodicidad,
      input.fecha_inicio,
      input.hora_inicio,
    ],
    { name: 'dga__insert_user' },
  );
  const row = r.rows[0];
  if (!row) throw new Error('INSERT dga_user no devolvió fila');
  return row;
}

export async function listDgaUsersBySite(siteId: string): Promise<DgaUserRow[]> {
  const r = await query<DgaUserRow>(
    `SELECT ${USER_COLS}
       FROM dga_user
      WHERE site_id = $1
      ORDER BY created_at DESC`,
    [siteId],
    { name: 'dga__list_users_by_site' },
  );
  return r.rows;
}

export async function findDgaUserById(idDgaUser: number): Promise<DgaUserRow | null> {
  const r = await query<DgaUserRow>(
    `SELECT ${USER_COLS} FROM dga_user WHERE id_dgauser = $1`,
    [idDgaUser],
    { name: 'dga__find_user' },
  );
  return r.rows[0] ?? null;
}

export async function listActiveDgaUsers(): Promise<DgaUserRow[]> {
  const r = await query<DgaUserRow>(`SELECT ${USER_COLS} FROM dga_user WHERE activo = TRUE`, [], {
    name: 'dga__list_active',
  });
  return r.rows;
}

export async function markDgaUserRun(idDgaUser: number, runAt: string): Promise<void> {
  await query(
    `UPDATE dga_user SET last_run_at = $2, updated_at = NOW() WHERE id_dgauser = $1`,
    [idDgaUser, runAt],
    { name: 'dga__mark_run' },
  );
}

export async function insertDatoDga(input: {
  id_dgauser: number;
  obra: string;
  ts: string;
  caudal_instantaneo: number | null;
  flujo_acumulado: number | null;
  nivel_freatico: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO dato_dga
       (id_dgauser, obra, ts, caudal_instantaneo, flujo_acumulado, nivel_freatico)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id_dgauser, ts) DO NOTHING`,
    [
      input.id_dgauser,
      input.obra,
      input.ts,
      input.caudal_instantaneo,
      input.flujo_acumulado,
      input.nivel_freatico,
    ],
    { name: 'dga__insert_dato' },
  );
}

export async function queryDatoDga(
  idDgaUser: number,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const r = await query<DatoDgaRow>(
    `SELECT id_dgauser, obra, ts,
            to_char(fecha, 'YYYY-MM-DD')       AS fecha,
            to_char(hora,  'HH24:MI:SS')       AS hora,
            caudal_instantaneo, flujo_acumulado, nivel_freatico
       FROM dato_dga
      WHERE id_dgauser = $1
        AND ts >= $2 AND ts < $3
      ORDER BY ts ASC`,
    [idDgaUser, desde, hasta],
    { name: 'dga__query_dato' },
  );
  return r.rows;
}

export async function queryDatoDgaBySite(
  siteId: string,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const r = await query<DatoDgaRow>(
    `SELECT d.id_dgauser, d.obra, d.ts,
            to_char(d.fecha, 'YYYY-MM-DD')      AS fecha,
            to_char(d.hora,  'HH24:MI:SS')      AS hora,
            d.caudal_instantaneo, d.flujo_acumulado, d.nivel_freatico
       FROM dato_dga d
       JOIN dga_user u USING (id_dgauser)
      WHERE u.site_id = $1
        AND d.ts >= $2 AND d.ts < $3
      ORDER BY d.ts ASC`,
    [siteId, desde, hasta],
    { name: 'dga__query_dato_by_site' },
  );
  return r.rows;
}
