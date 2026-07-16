/**
 * 2026-07-16 — Materialización contadores daily + jornada.
 *
 * Crea dos tablas para el cold path de contadores:
 *   - site_contador_diario: un registro por (sitio, variable, dia)
 *   - site_contador_jornada: un registro por (sitio, variable, dia, inicio, fin)
 *
 * El worker ENABLE_CONTADORES_DAILY_WORKER las mantiene frescas;
 * el endpoint cae a query on-demand si la fila materializada no existe.
 *
 * Idempotente.
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'timescaledb',
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || 'postgres',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
});

const SQL = `
-- ── site_contador_diario ─────────────────────────────────────────────────────
-- Un registro por (sitio, variable, dia Chile).
-- actualizado_at permite detectar filas stale para lazy-refresh.
CREATE TABLE IF NOT EXISTS site_contador_diario (
    sitio_id         VARCHAR(40)        NOT NULL,
    variable_id      VARCHAR(40)        NOT NULL,
    rol              VARCHAR(40)        NOT NULL,
    dia              DATE               NOT NULL,
    valor_inicio     DOUBLE PRECISION,
    valor_fin        DOUBLE PRECISION,
    delta            DOUBLE PRECISION,
    unidad           VARCHAR(30),
    muestras         INTEGER            NOT NULL DEFAULT 0,
    resets_detectados INTEGER           NOT NULL DEFAULT 0,
    ultimo_dato      TIMESTAMPTZ,
    actualizado_at   TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sitio_id, variable_id, dia)
);

CREATE INDEX IF NOT EXISTS idx_contador_diario_sitio_rol_dia
    ON site_contador_diario (sitio_id, rol, dia DESC);

-- ── site_contador_jornada ─────────────────────────────────────────────────────
-- Un registro por (sitio, variable, dia, inicio_hhmm, fin_hhmm).
-- inicio/fin definen la ventana de jornada; pueden cruzar medianoche (fin <= inicio).
CREATE TABLE IF NOT EXISTS site_contador_jornada (
    sitio_id         VARCHAR(40)        NOT NULL,
    variable_id      VARCHAR(40)        NOT NULL,
    rol              VARCHAR(40)        NOT NULL,
    dia              DATE               NOT NULL,
    inicio           VARCHAR(5)         NOT NULL,  -- 'HH:MM'
    fin              VARCHAR(5)         NOT NULL,  -- 'HH:MM'
    valor_inicio     DOUBLE PRECISION,
    valor_fin        DOUBLE PRECISION,
    delta            DOUBLE PRECISION,
    unidad           VARCHAR(30),
    muestras         INTEGER            NOT NULL DEFAULT 0,
    resets_detectados INTEGER           NOT NULL DEFAULT 0,
    ultimo_dato      TIMESTAMPTZ,
    actualizado_at   TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sitio_id, variable_id, dia, inicio, fin)
);

CREATE INDEX IF NOT EXISTS idx_contador_jornada_sitio_rol_dia
    ON site_contador_jornada (sitio_id, rol, dia DESC);
`;

async function migrate() {
  try {
    console.log('[migration 007] site_contador_diario + site_contador_jornada...');
    await pool.query(SQL);
    console.log('[migration 007] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 007] ERROR:', err);
    process.exit(1);
  }
}

migrate();
