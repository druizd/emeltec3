-- Minimal schema for csvconsumer local testing.
-- Plain PostgreSQL (no TimescaleDB required).
-- Only creates the table csvconsumer writes to.

CREATE TABLE IF NOT EXISTS equipo (
    time      TIMESTAMPTZ NOT NULL,
    id_serial TEXT        NOT NULL,
    data      JSONB
);
