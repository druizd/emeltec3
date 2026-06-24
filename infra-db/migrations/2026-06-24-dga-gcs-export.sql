-- 2026-06-24 — Export DGA → Google Cloud Storage (Parquet).
--
-- Solicitado por CCU_Central (dueño de las instalaciones CCU) para recibir
-- copia de cada registro DGA por el que la API de SNIA EMITIÓ RESPUESTA, sea
-- aceptado (status '00') o rechazado (cualquier otro código). NUNCA se exporta
-- un registro sin respuesta de DGA (network_error / timeout / pre-send error
-- → dga_status_code NULL en dga_send_audit).
--
-- Diseño GENÉRICO: aplicable a cualquier empresa, no hardcodeado a CCU. La
-- selección de qué instalaciones exportan es por-sitio vía
-- pozo_config.dga_gcs_export. CCU solo se documenta como solicitante.
--
-- DOWN-MIGRATION documentado al final.

BEGIN;

-- ─── UP ──────────────────────────────────────────────────────────────────────

-- Flag por-pozo: si TRUE, los envíos DGA respondidos de este sitio se exportan
-- a GCS. Default FALSE → opt-in explícito por instalación.
ALTER TABLE pozo_config
    ADD COLUMN IF NOT EXISTS dga_gcs_export BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN pozo_config.dga_gcs_export IS
    'Si TRUE, el worker dga-gcs-exporter sube a Google Cloud Storage (Parquet) '
    'cada envío DGA de este sitio por el que SNIA respondió (enviado o rechazado). '
    'Genérico para cualquier empresa; solicitado inicialmente por CCU_Central.';

-- Ledger de exportaciones a GCS. Append-only. Doble propósito:
--   1) Dedup: el worker no re-exporta un audit ya subido (UNIQUE audit_id).
--   2) Auditoría: permite a CCU/Emeltec reconciliar qué se entregó al data lake.
--
-- audit_id referencia dga_send_audit.id (FK lógica, no constraint físico para
-- no acoplar el ledger al ciclo de vida del audit — patrón del módulo DGA).
CREATE TABLE IF NOT EXISTS dga_gcs_export_log (
    id              BIGSERIAL    PRIMARY KEY,
    audit_id        BIGINT       NOT NULL,
    site_id         VARCHAR(10)  NOT NULL,
    ts              TIMESTAMPTZ  NOT NULL,
    dga_status_code VARCHAR(10),
    comprobante     TEXT,
    gcs_bucket      VARCHAR(255) NOT NULL,
    gcs_path        TEXT         NOT NULL,
    row_count       INTEGER      NOT NULL,
    -- Acuse de GCS (prueba de entrega): version del objeto + checksum MD5 que
    -- devolvió GCS al subir. Permite a CCU/Emeltec reconciliar integridad.
    gcs_generation  TEXT,
    gcs_md5         TEXT,
    exported_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_gcs_export_audit UNIQUE (audit_id)
);

COMMENT ON TABLE dga_gcs_export_log IS
    'Ledger append-only de envíos DGA exportados a Google Cloud Storage. '
    'UNIQUE(audit_id) garantiza idempotencia (no re-subir). Sirve de pista de '
    'auditoría de lo entregado al data lake de CCU_Central.';

-- Lookup del worker: dado un sitio, qué audits ya se exportaron.
CREATE INDEX IF NOT EXISTS idx_gcs_export_site_ts
    ON dga_gcs_export_log (site_id, ts);

-- ─── DOWN (documentado — ejecutar manualmente con precaución) ─────────────
-- DROP INDEX IF EXISTS idx_gcs_export_site_ts;
-- DROP TABLE IF EXISTS dga_gcs_export_log;
-- ALTER TABLE pozo_config DROP COLUMN IF EXISTS dga_gcs_export;

COMMIT;
