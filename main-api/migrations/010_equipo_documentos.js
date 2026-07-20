/**
 * 2026-07-20 — Bitácora: vínculo equipamiento ↔ documentos.
 *
 * Agrega sitio_equipo.documento_ids (BIGINT[]): ids de documentos vinculados
 * al equipo. Modelado como array por decisión de producto (vista equipo → sus
 * docs, escritura simple).
 *
 * TRADEOFF conocido: un BIGINT[] no tiene integridad referencial. Si se borra
 * un documento, su id queda huérfano en documento_ids — no hay ON DELETE
 * CASCADE como en el resto del esquema. Aceptado explícitamente.
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
ALTER TABLE sitio_equipo
  ADD COLUMN IF NOT EXISTS documento_ids BIGINT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN sitio_equipo.documento_ids IS
  'Ids de documentos (tabla documentos) vinculados al equipo. Array sin FK: '
  'puede contener ids huérfanos si se borra el documento. Decisión de producto.';
`;

async function migrate() {
  try {
    console.log('[migration 010] sitio_equipo.documento_ids...');
    await pool.query(SQL);
    console.log('[migration 010] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 010] ERROR:', err);
    process.exit(1);
  }
}

migrate();
