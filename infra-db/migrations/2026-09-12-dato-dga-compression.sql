-- ============================================================================
-- Compression policy para dato_dga (TimescaleDB)
-- ============================================================================
-- Espeja el cambio agregado a infra-db/init-db/01-init-schema.sql (solo corre
-- en container nuevo, con volumen vacío). En un servidor con la DB ya
-- existente hay que aplicar esto a mano.
-- Idempotente: safe re-run (if_not_exists => TRUE).
-- ============================================================================
BEGIN;

ALTER TABLE dato_dga SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id',
    timescaledb.compress_orderby   = 'ts DESC'
);

SELECT add_compression_policy('dato_dga',
    compress_after => INTERVAL '30 days',
    if_not_exists  => TRUE
);

COMMIT;
