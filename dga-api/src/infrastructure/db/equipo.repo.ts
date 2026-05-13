import { pool } from './pool';

export interface EquipoRow {
  time: Date;
  idSerial: string;
  data: Record<string, unknown>;
  receivedAt: Date;
}

export async function getLatestByIdSerial(idSerial: string): Promise<EquipoRow | null> {
  const { rows } = await pool.query(
    `SELECT time, id_serial, data, received_at
       FROM equipo
      WHERE id_serial = $1
      ORDER BY time DESC
      LIMIT 1`,
    [idSerial],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    time: r.time,
    idSerial: r.id_serial,
    data: r.data ?? {},
    receivedAt: r.received_at,
  };
}

export async function getLatestBefore(idSerial: string, before: Date): Promise<EquipoRow | null> {
  const { rows } = await pool.query(
    `SELECT time, id_serial, data, received_at
       FROM equipo
      WHERE id_serial = $1
        AND time <= $2
      ORDER BY time DESC
      LIMIT 1`,
    [idSerial, before],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    time: r.time,
    idSerial: r.id_serial,
    data: r.data ?? {},
    receivedAt: r.received_at,
  };
}
