-- 2026-05-22 — Continuous aggregates de DATA sobre `equipo`.
--
-- Los caggs preexistentes (equipo_daily/weekly/monthly/yearly) solo guardaban
-- COUNT(*). Ningun query del backend los lee → basura materializada. Se
-- reemplazan por caggs nuevos que ademas del count guardan el ultimo `data`
-- (jsonb) y `received_at` por bucket.
--
-- Resoluciones:
--   equipo_1min   → dashboard history, CSV export, sites latest-by-minute
--   equipo_5min   → contadores/jornadas, gap analysis 30 dias
--   equipo_hourly → DGA telemetria horaria, vistas medias
--   equipo_daily  → DGA diario, exports largos (meses/anios)
--
-- Cada cagg guarda: bucket, id_serial, last(data, time), last(received_at, time),
-- count(*) AS samples. El count cubre el caso de uso de los caggs viejos.
--
-- IDEMPOTENCIA: scripts/deploy-production.sh re-aplica TODAS las migrations
-- en cada deploy. Por eso:
--   - DROP envuelto en DO block que detecta la firma vieja (columna
--     total_registros). Solo dropea si encuentra el cagg count-only.
--   - CREATE usa IF NOT EXISTS.
--   - add_continuous_aggregate_policy usa if_not_exists => TRUE.
--   - CREATE INDEX usa IF NOT EXISTS.
-- Asi, deploys posteriores no destruyen los datos ya materializados.
--
-- NOTA: TimescaleDB permite leer datos mas recientes que el cagg
-- (`materialized_only=false` es default desde TS 2.x), asi que queries que
-- mezclen pasado materializado + minuto actual raw funcionan transparentemente.
--
-- No envolvemos en BEGIN/COMMIT — `add_continuous_aggregate_policy` y los
-- DROP/CREATE de caggs deben correr fuera de transaccion.

-- ============================================================
-- 1. Drop caggs viejos (count-only, sin uso) — solo si aun
--    tienen la firma vieja. Idempotente entre deploys.
-- ============================================================

-- equipo_daily viejo tenia columna total_registros. El nuevo no.
-- Si encontramos esa columna => es la version vieja => DROP.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'equipo_daily' AND column_name = 'total_registros'
    ) THEN
        DROP MATERIALIZED VIEW equipo_daily CASCADE;
    END IF;
END$$;

-- equipo_weekly/monthly/yearly no existen en el schema nuevo.
-- DROP IF EXISTS es no-op en deploys posteriores.
DROP MATERIALIZED VIEW IF EXISTS equipo_weekly  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS equipo_monthly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS equipo_yearly  CASCADE;

-- ============================================================
-- 2. equipo_1min — dashboard history, CSV export, sites latest
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    id_serial,
    last(data, time)         AS data,
    last(received_at, time)  AS received_at,
    count(*)                 AS samples
FROM equipo
GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_1min',
    start_offset      => INTERVAL '7 days',
    end_offset        => INTERVAL '2 minutes',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists     => TRUE);

CREATE INDEX IF NOT EXISTS idx_equipo_1min_serial_bucket
    ON equipo_1min (id_serial, bucket DESC);

-- ============================================================
-- 3. equipo_5min — jornadas, contadores, gap analysis
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_5min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    id_serial,
    last(data, time)         AS data,
    last(received_at, time)  AS received_at,
    count(*)                 AS samples
FROM equipo
GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_5min',
    start_offset      => INTERVAL '30 days',
    end_offset        => INTERVAL '10 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists     => TRUE);

CREATE INDEX IF NOT EXISTS idx_equipo_5min_serial_bucket
    ON equipo_5min (id_serial, bucket DESC);

-- ============================================================
-- 4. equipo_hourly — DGA telemetria, vistas medias
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    id_serial,
    last(data, time)         AS data,
    last(received_at, time)  AS received_at,
    count(*)                 AS samples
FROM equipo
GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_hourly',
    start_offset      => INTERVAL '90 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists     => TRUE);

CREATE INDEX IF NOT EXISTS idx_equipo_hourly_serial_bucket
    ON equipo_hourly (id_serial, bucket DESC);

-- ============================================================
-- 5. equipo_daily — DGA diario, exports largos (meses/anios)
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    id_serial,
    last(data, time)         AS data,
    last(received_at, time)  AS received_at,
    count(*)                 AS samples
FROM equipo
GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_daily',
    start_offset      => INTERVAL '3 years',
    end_offset        => INTERVAL '1 day',
    schedule_interval => INTERVAL '6 hours',
    if_not_exists     => TRUE);

CREATE INDEX IF NOT EXISTS idx_equipo_daily_serial_bucket
    ON equipo_daily (id_serial, bucket DESC);

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON VIEW equipo_1min IS
    'Cagg 1-min con last(data, time) + count(*). Para dashboard-history, CSV export y sites latest-by-minute. Refresh cada 1 min, end_offset 2 min.';
COMMENT ON VIEW equipo_5min IS
    'Cagg 5-min con last(data, time) + count(*). Para contadores/jornadas y gap analysis 30 dias. Refresh cada 5 min.';
COMMENT ON VIEW equipo_hourly IS
    'Cagg 1-hora con last(data, time) + count(*). Para DGA telemetria horaria y vistas medias. Refresh cada 30 min.';
COMMENT ON VIEW equipo_daily IS
    'Cagg 1-dia con last(data, time) + count(*). Para DGA diario y exports largos (meses/anios). Refresh cada 6 h. Reemplaza al cagg count-only previo.';

-- ============================================================
-- Backfill inicial — EJECUTAR MANUALMENTE despues del primer deploy
-- ============================================================
--
-- NO se incluye en la migracion porque deploy-production.sh re-aplica
-- migrations en cada deploy y refresh_continuous_aggregate sobre todo
-- el historico puede bloquear minutos. La refresh policy mantiene los
-- caggs al dia automaticamente para datos nuevos; el backfill historico
-- es one-shot.
--
-- Ejecutar manualmente UNA vez tras aplicar esta migracion:
--
--   docker compose exec -T timescaledb psql -U postgres -d telemetry_platform <<'EOF'
--   CALL refresh_continuous_aggregate('equipo_1min',   NULL, now() - INTERVAL '2 minutes');
--   CALL refresh_continuous_aggregate('equipo_5min',   NULL, now() - INTERVAL '10 minutes');
--   CALL refresh_continuous_aggregate('equipo_hourly', NULL, now() - INTERVAL '1 hour');
--   CALL refresh_continuous_aggregate('equipo_daily',  NULL, now() - INTERVAL '1 day');
--   EOF
