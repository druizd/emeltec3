/**
 * 2026-07-20 — Asignación de instalaciones a usuarios (M:N).
 *
 * Pensado para el rol Vendedor (equipo comercial Emeltec): además de ver todas
 * las maletas piloto (sitio.es_maleta_piloto), se le asignan instalaciones
 * puntuales — las que vende/demuestra — sin importar su empresa. El scope de
 * Vendedor pasa a ser: es_maleta_piloto = true OR id IN (asignadas).
 *
 * Genérico (usuario_sitio) por si a futuro se asigna a otros roles.
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
CREATE TABLE IF NOT EXISTS usuario_sitio (
  usuario_id  VARCHAR(10)  NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  sitio_id    VARCHAR(10)  NOT NULL REFERENCES sitio(id)   ON DELETE CASCADE,
  created_by  VARCHAR(10)  REFERENCES usuario(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, sitio_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_sitio_usuario ON usuario_sitio (usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_sitio_sitio   ON usuario_sitio (sitio_id);

COMMENT ON TABLE usuario_sitio IS
  'Instalaciones asignadas a un usuario (rol Vendedor). Se suman a las maletas '
  'piloto en su scope de visibilidad. Solo lectura para el vendedor.';
`;

async function migrate() {
  try {
    console.log('[migration 012] usuario_sitio...');
    await pool.query(SQL);
    console.log('[migration 012] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 012] ERROR:', err);
    process.exit(1);
  }
}

migrate();
