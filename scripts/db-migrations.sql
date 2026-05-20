-- Migrations idempotentes — seguro correr múltiples veces.
-- Se ejecutan automáticamente via servicio db-migrate en docker-compose.

-- equipo_1min: continuous aggregate de TimescaleDB.
-- Pre-calcula time_bucket('1 minute') por id_serial para acelerar
-- queries de contadores (contadores__jornada_rows: 10-20s → <100ms).
CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_1min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  id_serial,
  last(data, time) AS data
FROM equipo
GROUP BY 1, 2;

-- Refresh policy: actualiza datos de los últimos 2 días cada 1 minuto.
-- Usa DO block para que no falle si la policy ya existe.
DO $$
BEGIN
  PERFORM add_continuous_aggregate_policy('equipo_1min',
    start_offset      => INTERVAL '2 days',
    end_offset        => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');
EXCEPTION WHEN others THEN
  NULL;
END;
$$;
