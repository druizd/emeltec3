import type { Pool } from 'pg';

/** Resuelve el id_serial del registro más reciente disponible en `equipo`. */
export async function getLatestSerialId(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ id_serial: string }>(
    `SELECT id_serial FROM equipo ORDER BY time DESC LIMIT 1`,
  );
  return rows[0]?.id_serial ?? null;
}
