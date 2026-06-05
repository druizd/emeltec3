/**
 * 2026-06-05 — Cold-room HACCP persistence.
 *   1. cold_room_threshold: umbral por sala (banda T máxima/mínima + parámetros)
 *   2. cold_room_defrost_window: ventanas defrost programadas
 *   3. cold_room_deviation_ack: acks + causa por desviación
 *   4. cold_room_audit_log: bitácora de cambios HACCP (umbrales/defrost/desviaciones)
 *
 * Cumplimiento: SERNAPESCA Res. Ex. 3160/2016 (Programa Sanitario Productos
 * Pesqueros), Codex Alimentarius CAC/RCP 1-1969 (HACCP).
 *
 * Idempotente.
 */
const db = require('../src/config/db');

const SQL = `
-- Umbrales por sala (HACCP critical limits).
CREATE TABLE IF NOT EXISTS cold_room_threshold (
    site_id        VARCHAR(40)        NOT NULL,
    sala_slug      VARCHAR(120)       NOT NULL,
    area           VARCHAR(200)       NOT NULL,
    t_max          DOUBLE PRECISION   NOT NULL,
    t_min          DOUBLE PRECISION,
    warn_delta_c   DOUBLE PRECISION,
    sustained_min  INTEGER,
    severe_min     INTEGER,
    hysteresis_c   DOUBLE PRECISION,
    note           TEXT,
    updated_at     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_by     VARCHAR(150),
    PRIMARY KEY (site_id, sala_slug)
);
-- Idempotente para deployments incrementales.
ALTER TABLE cold_room_threshold ADD COLUMN IF NOT EXISTS note TEXT;

-- Ventanas defrost programadas.
CREATE TABLE IF NOT EXISTS cold_room_defrost_window (
    id             VARCHAR(40)   PRIMARY KEY,
    site_id        VARCHAR(40)   NOT NULL,
    sala_slug      VARCHAR(120)  NOT NULL,
    start_hhmm     VARCHAR(5)    NOT NULL,
    duration_min   INTEGER       NOT NULL,
    days_of_week   INTEGER[]     NOT NULL DEFAULT '{}',
    enabled        BOOLEAN       NOT NULL DEFAULT TRUE,
    note           TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cold_room_defrost_site_sala
    ON cold_room_defrost_window (site_id, sala_slug);

-- Acks/causas de desviaciones HACCP.
CREATE TABLE IF NOT EXISTS cold_room_deviation_ack (
    site_id        VARCHAR(40)        NOT NULL,
    deviation_id   VARCHAR(200)       NOT NULL,
    acknowledged   BOOLEAN            NOT NULL DEFAULT FALSE,
    acked_at       TIMESTAMPTZ,
    acked_by       VARCHAR(150),
    note           TEXT,
    resolved       BOOLEAN            NOT NULL DEFAULT FALSE,
    resolved_at    TIMESTAMPTZ,
    cause          VARCHAR(40),
    cause_source   VARCHAR(10),
    cause_by       VARCHAR(150),
    cause_at       TIMESTAMPTZ,
    cause_note     TEXT,
    updated_at     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, deviation_id)
);

-- Bitácora HACCP local (separada de audit_log general del sistema).
CREATE TABLE IF NOT EXISTS cold_room_audit_log (
    id             BIGSERIAL      PRIMARY KEY,
    site_id        VARCHAR(40)    NOT NULL,
    ts             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    actor          VARCHAR(200),
    actor_role     VARCHAR(30),
    category       VARCHAR(20)    NOT NULL,
    action         VARCHAR(40)    NOT NULL,
    target         VARCHAR(200)   NOT NULL,
    prev           JSONB,
    next           JSONB,
    note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_cold_room_audit_site_ts
    ON cold_room_audit_log (site_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cold_room_audit_category
    ON cold_room_audit_log (site_id, category, ts DESC);
`;

async function migrate() {
  try {
    console.log('[migration 006] cold_room HACCP tables…');
    await db.query(SQL);
    console.log('[migration 006] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 006] ERROR:', err);
    process.exit(1);
  }
}

migrate();
