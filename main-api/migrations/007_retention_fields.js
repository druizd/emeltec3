/**
 * Migración 007 — Retención de datos y alertas de seguridad (B5.2 + B4.2)
 *
 * Agrega:
 * - usuario.aviso_inactividad_enviado_at: fecha en que se envió el aviso de
 *   inactividad próxima (24 meses sin login). Permite al job de retención
 *   saber si ya notificó al usuario antes de proceder a anonimizar.
 *
 * - audit_alert_cooldown: tabla de cooldown para alertas automáticas de
 *   seguridad (B4.2). Evita re-enviar la misma alerta en ventana de tiempo.
 */
const db = require('../src/config/db');

const SQL = `
ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS aviso_inactividad_enviado_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS audit_alert_cooldown (
  id           SERIAL PRIMARY KEY,
  alert_key    VARCHAR(120) NOT NULL UNIQUE,
  last_sent_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_alert_cooldown_key
  ON audit_alert_cooldown (alert_key);
`;

async function migrate() {
  console.log('[migration 007] Iniciando — retention fields + audit_alert_cooldown...');
  await db.query(SQL);
  console.log('[migration 007] OK');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('[migration 007] ERROR:', err.message);
  process.exit(1);
});
