-- ============================================================================
-- Compresión (columnstore) para los caggs `equipo_1min` y `equipo_5min`
-- ============================================================================
-- El hypertable crudo `equipo` ya está comprimido con `segmentby = id_serial`
-- desde su creación. Los caggs derivados nunca lo estuvieron, y eso salió caro:
--
-- Medido en producción el 21-09-2026 (TimescaleDB 2.27, PG 16.15), mismo
-- serial y mismo mes, `EXPLAIN (ANALYZE, BUFFERS)`:
--
--                      | equipo_1min (sin compr.) | equipo crudo (compr.)
--   -------------------+--------------------------+----------------------
--   filas              | 44.313                   | 44.325
--   tiempo             | 19.719 ms                | 371 ms
--   buffers tocados    | 42.764                   | 1.166
--
-- Sin `segmentby`, las filas quedan ordenadas por bucket y los seriales se
-- intercalan: leer un mes de UN serial toca casi una página por fila
-- (`Heap Blocks: exact` ≈ nº de filas). 37x más I/O y 53x más lento.
--
-- Consecuencia visible: el worker de contadores (`modules/contadores/worker.ts`,
-- cada hora, últimos 2 meses, ~34 contadores) revienta contra el
-- `statement_timeout` de 10 s en la query `contadores__month_rows` para 2-3
-- variables por ciclo (S100/RM6013C1E6, S105/RMD16994C1, S123/RMCA679914).
--
-- Y el costo en disco: `_materialized_hypertable_8` (equipo_1min) son 3.936 MB
-- de una base de 6.601 MB — el 60%. El crudo comprimido, con los MISMOS datos,
-- son 171 MB (ratio real 24,8x sobre 911 chunks).
--
-- ----------------------------------------------------------------------------
-- EL NÚMERO QUE NO HAY QUE EQUIVOCAR: compress_after > start_offset
-- ----------------------------------------------------------------------------
-- Comprimir un chunk del cagg lo cierra a futuros refrescos. La política de
-- refresco de cada cagg (2026-05-22-equipo-data-caggs.sql) tiene su propio
-- `start_offset`, y `compress_after` TIENE que ser mayor, o el refresco chocará
-- contra chunks comprimidos.
--
-- TimescaleDB **no valida esto**: verificado el 21-09-2026, aceptó sin error un
-- `compress_after => INTERVAL '3 days'` contra un `start_offset` de 7 días. El
-- margen corre por nuestra cuenta.
--
--   cagg          | start_offset | chunk  | compress_after | margen
--   --------------+--------------+--------+----------------+--------
--   equipo_1min   | 7 días       | 10 días| 14 días        | 7 días
--   equipo_5min   | 30 días      | 10 días| 45 días        | 15 días
--
-- Los últimos 7 días de `equipo_1min` quedan sin comprimir a propósito: son los
-- que el refresco sigue tocando.
--
-- ----------------------------------------------------------------------------
-- QUÉ NO TOCA ESTA MIGRACIÓN
-- ----------------------------------------------------------------------------
-- `equipo_hourly` (63 MB) y `equipo_daily` (7 MB) se dejan como están: juntos
-- son el 1,5% del disco de los caggs, y sus `start_offset` de 90 días y 3 años
-- obligarían a `compress_after` absurdamente largos para ganar nada.
--
-- ----------------------------------------------------------------------------
-- IDEMPOTENCIA
-- ----------------------------------------------------------------------------
-- `scripts/deploy-production.sh` re-aplica TODAS las migraciones en cada deploy,
-- con `psql -v ON_ERROR_STOP=1` y `set -Eeuo pipefail`, ANTES de levantar los
-- containers: un error acá aborta el deploy entero. Verificado el 21-09-2026
-- contra producción (en transacción revertida) que la re-aplicación es segura:
--   - el segundo `ALTER ... SET (timescaledb.compress ...)` idéntico no falla;
--   - `add_compression_policy(..., if_not_exists => TRUE)` devuelve -1 y avisa
--     "columnstore policy already exists ... skipping".
-- El guard por `to_regclass` cubre además la base vacía de CI, donde el cagg
-- podría no existir todavía.
--
-- No comprime nada de entrada: la política comprime los chunks elegibles de a
-- poco, en su job de mantenimiento. Para forzar un chunk puntual existe
-- `compress_chunk()`.
-- ============================================================================

-- ============================================================
-- 1. equipo_1min — el grande (3.936 MB)
-- ============================================================
DO $$
BEGIN
    IF to_regclass('public.equipo_1min') IS NULL THEN
        RAISE NOTICE 'equipo_1min no existe; se omite la compresión.';
        RETURN;
    END IF;

    EXECUTE $ddl$
        ALTER MATERIALIZED VIEW equipo_1min SET (
            timescaledb.compress           = true,
            timescaledb.compress_segmentby = 'id_serial',
            timescaledb.compress_orderby   = 'bucket DESC'
        )
    $ddl$;

    -- 14 días > los 7 del start_offset del refresco. Ver la tabla del encabezado.
    PERFORM add_compression_policy('equipo_1min',
        compress_after => INTERVAL '14 days',
        if_not_exists  => TRUE);
END$$;

-- ============================================================
-- 2. equipo_5min — contadores/jornadas, gap analysis (735 MB)
-- ============================================================
DO $$
BEGIN
    IF to_regclass('public.equipo_5min') IS NULL THEN
        RAISE NOTICE 'equipo_5min no existe; se omite la compresión.';
        RETURN;
    END IF;

    EXECUTE $ddl$
        ALTER MATERIALIZED VIEW equipo_5min SET (
            timescaledb.compress           = true,
            timescaledb.compress_segmentby = 'id_serial',
            timescaledb.compress_orderby   = 'bucket DESC'
        )
    $ddl$;

    -- 45 días > los 30 del start_offset del refresco.
    PERFORM add_compression_policy('equipo_5min',
        compress_after => INTERVAL '45 days',
        if_not_exists  => TRUE);
END$$;
