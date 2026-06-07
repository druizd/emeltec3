-- Evita duplicados exactos de telemetria por equipo y timestamp.
-- TimescaleDB exige incluir la dimension temporal en indices unicos.

DELETE FROM equipo a
USING equipo b
WHERE a.id_serial = b.id_serial
  AND a.time = b.time
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipo_unique_serial_time
ON equipo (id_serial, time);
