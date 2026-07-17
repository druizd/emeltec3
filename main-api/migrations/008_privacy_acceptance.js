/**
 * Migración 008 — Aceptación de política de privacidad (B7.2)
 *
 * Agrega:
 * - usuario.politica_aceptada_at: fecha en que el usuario aceptó la política
 *   de privacidad. NULL = no ha aceptado. Idempotente: no sobreescribe si ya
 *   tiene fecha (ver controller aceptarPolitica).
 */
const db = require('../src/config/db');

const SQL = `
ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS politica_aceptada_at TIMESTAMPTZ;
`;

async function migrate() {
  console.log('[migration 008] Iniciando — privacy acceptance field...');
  await db.query(SQL);
  console.log('[migration 008] OK');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('[migration 008] ERROR:', err.message);
  process.exit(1);
});
