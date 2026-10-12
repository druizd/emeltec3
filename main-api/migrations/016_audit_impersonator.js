/**
 * 2026-10-12 — Modo "ver como" de SuperAdmin: la bitácora identifica al
 * suplantador.
 *
 * `audit_log.impersonator_id` guarda el id del SuperAdmin real cuando la acción
 * (o el intento rechazado) se hizo con un token "ver como". Nulo en el resto de
 * los registros. Aditiva y nullable: no toca filas existentes.
 *
 * Idempotente y no-op sobre una base que ya la tiene.
 */
const db = require('../src/config/db');

const SQL = `
ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS impersonator_id VARCHAR(10);

COMMENT ON COLUMN audit_log.impersonator_id IS
    'SuperAdmin real que actuó con un token "ver como". NULL si la acción no fue suplantada.';

CREATE INDEX IF NOT EXISTS idx_audit_log_impersonator ON audit_log (impersonator_id, ts DESC)
    WHERE impersonator_id IS NOT NULL;
`;

async function migrate() {
  try {
    console.log('[migration 016] audit_log.impersonator_id (ver como)...');
    await db.query(SQL);
    console.log('[migration 016] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 016] ERROR:', err);
    process.exit(1);
  }
}

migrate();
