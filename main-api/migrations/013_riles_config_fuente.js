/**
 * 2026-09-14 — Módulo RILes: configuración del sitio y vínculo con sus fuentes.
 *
 * Un sitio de RILes casi nunca se explica solo: el volumen que descarga sale
 * del agua que la planta extrajo de uno o más pozos. `riles_fuente` declara ese
 * vínculo — qué sitio aporta, con qué prorrateo y entre qué fechas — y
 * `riles_config` guarda cómo se arma el caudal de salida y contra qué norma se
 * compara la descarga.
 *
 * Tabla aparte de `pozo_config` a propósito: RILes es SISS/SMA, no DGA. Son dos
 * ciclos regulatorios distintos y mezclarlos en la misma fila los amarra.
 *
 * Ver docs/riles-propuesta-modulo.md.
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
-- ── riles_config ─────────────────────────────────────────────────────────────
-- Una fila por sitio de RILes. Espejo de pozo_config en forma, no en contenido.
CREATE TABLE IF NOT EXISTS riles_config (
  sitio_id                   VARCHAR(10)  PRIMARY KEY REFERENCES sitio(id) ON DELETE CASCADE,
  modo_caudal                VARCHAR(10)  NOT NULL DEFAULT 'propio',
  coef_descarga_esperado_pct NUMERIC(5,2),
  coef_tolerancia_pct        NUMERIC(5,2) NOT NULL DEFAULT 15,
  norma                      VARCHAR(10),
  punto_descarga             VARCHAR(80),
  caudal_max_autorizado_lps  NUMERIC(10,2),
  volumen_max_mensual_m3     NUMERIC(14,2),
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS no altera una tabla que ya existe: cada columna
-- nueva necesita su propio ALTER, o no llega a producción y falla en silencio.
ALTER TABLE riles_config ADD COLUMN IF NOT EXISTS modo_caudal                VARCHAR(10)  NOT NULL DEFAULT 'propio';
ALTER TABLE riles_config ADD COLUMN IF NOT EXISTS coef_descarga_esperado_pct NUMERIC(5,2);
ALTER TABLE riles_config ADD COLUMN IF NOT EXISTS coef_tolerancia_pct        NUMERIC(5,2) NOT NULL DEFAULT 15;
ALTER TABLE riles_config ADD COLUMN IF NOT EXISTS norma                      VARCHAR(10);
ALTER TABLE riles_config ADD COLUMN IF NOT EXISTS punto_descarga             VARCHAR(80);
ALTER TABLE riles_config ADD COLUMN IF NOT EXISTS caudal_max_autorizado_lps  NUMERIC(10,2);
ALTER TABLE riles_config ADD COLUMN IF NOT EXISTS volumen_max_mensual_m3     NUMERIC(14,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'riles_config_modo_caudal_chk'
  ) THEN
    ALTER TABLE riles_config ADD CONSTRAINT riles_config_modo_caudal_chk
      CHECK (modo_caudal IN ('propio', 'derivado', 'mixto'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'riles_config_norma_chk'
  ) THEN
    ALTER TABLE riles_config ADD CONSTRAINT riles_config_norma_chk
      CHECK (norma IS NULL OR norma IN ('ds90', 'ds46', 'ds609', 'rca'));
  END IF;
END $$;

COMMENT ON TABLE riles_config IS
  'Configuracion del sitio de RILes: como se arma el caudal de salida '
  '(modo_caudal) y contra que norma se compara la descarga. No es DGA.';
COMMENT ON COLUMN riles_config.modo_caudal IS
  'propio = medidor en la descarga; derivado = estimado desde las fuentes con '
  'coef_descarga_esperado_pct; mixto = el propio cuando hay dato, derivado si no.';

-- ── riles_fuente ─────────────────────────────────────────────────────────────
-- Vinculo N:M entre el sitio de RILes y los sitios que alimentan su balance.
CREATE TABLE IF NOT EXISTS riles_fuente (
  id              BIGSERIAL    PRIMARY KEY,
  riles_sitio_id  VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
  fuente_sitio_id VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE RESTRICT,
  rol             VARCHAR(30)  NOT NULL DEFAULT 'totalizador',
  factor          NUMERIC(8,4) NOT NULL DEFAULT 1,
  direccion       VARCHAR(10)  NOT NULL DEFAULT 'entrada',
  vigencia_desde  DATE         NOT NULL,
  vigencia_hasta  DATE,
  nota            TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT riles_fuente_no_autoref CHECK (riles_sitio_id <> fuente_sitio_id),
  CONSTRAINT riles_fuente_direccion_chk CHECK (direccion IN ('entrada', 'salida')),
  CONSTRAINT riles_fuente_vigencia_chk CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

-- Una misma fuente puede alimentar varios RILes, y puede entrar dos veces al
-- mismo RILes con distintas ventanas (cambio de prorrateo). Lo que no puede es
-- repetirse con la misma ventana.
CREATE UNIQUE INDEX IF NOT EXISTS riles_fuente_uniq
  ON riles_fuente (riles_sitio_id, fuente_sitio_id, rol, vigencia_desde);
CREATE INDEX IF NOT EXISTS idx_riles_fuente_riles  ON riles_fuente (riles_sitio_id);
CREATE INDEX IF NOT EXISTS idx_riles_fuente_fuente ON riles_fuente (fuente_sitio_id);

COMMENT ON TABLE riles_fuente IS
  'Sitios que alimentan el balance de un sitio RILes (pozos, vertientes, '
  'canales u otros RILes), con prorrateo y ventana de vigencia.';
COMMENT ON COLUMN riles_fuente.factor IS
  'Prorrateo del aporte: 0.5 si el pozo abastece dos plantas. NO es el '
  'coeficiente de descarga — ese vive en riles_config.';
COMMENT ON COLUMN riles_fuente.vigencia_hasta IS
  'NULL = vigente. Dar de baja una fuente cierra la ventana, no borra la fila: '
  'borrarla reescribiria el historico que el cliente ya vio.';
`;

async function migrate() {
  try {
    console.log('[migration 013] riles_config + riles_fuente...');
    await pool.query(SQL);
    console.log('[migration 013] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 013] ERROR:', err);
    process.exit(1);
  }
}

migrate();
