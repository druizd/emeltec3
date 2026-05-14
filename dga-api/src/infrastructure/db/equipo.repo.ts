// Acceso a la tabla `equipo` (hypertable de telemetría cruda recibida desde los equipos en campo).
// Cada fila lleva un JSON `data` con los registros Modbus tal como llegaron.
import { pool } from './pool';

// Fila de telemetría. `data` es un objeto cuyas claves coinciden con los `d1`/`d2` de reg_map.
export interface EquipoRow {
  time: Date;
  idSerial: string;
  data: Record<string, unknown>;
  receivedAt: Date;
}

// Trae la última telemetría disponible para un serial dado (sin filtro temporal).
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

// Trae la telemetría más reciente recibida en o antes del `before`.
// El usecase de ingestión la usa para asociar al reporte el dato más cercano al instante de cierre del período.
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
