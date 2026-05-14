/**
 * 2026-05-14 — Cumplimiento Ley 21.663 (Marco Ciberseguridad) + Ley 21.719 (Datos Personales).
 *   1. audit_log: bitácora persistente
 *   2. usuario.failed_logins + locked_until + last_login_*: lockout
 *   3. usuario.otp_requests_*: rate-limit OTP por email
 *
 * Idempotente. Refleja infra-db/migrations/2026-05-14-audit-log-and-lockout.sql
 */
const db = require('../src/config/db');

const SQL = `
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    ts              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actor_id        VARCHAR(10),
    actor_email     VARCHAR(150),
    actor_tipo      VARCHAR(30),
    action          VARCHAR(60)  NOT NULL,
    target_type     VARCHAR(40),
    target_id       VARCHAR(40),
    payload_hash    VARCHAR(64),
    ip              VARCHAR(45),
    user_agent      VARCHAR(255),
    status_code     INTEGER,
    metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts     ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log (actor_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log (target_type, target_id, ts DESC);

ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS failed_logins   INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_login_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_login_ip   VARCHAR(45),
    ADD COLUMN IF NOT EXISTS otp_requests_count        INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS otp_requests_window_start TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuario_locked_until ON usuario (locked_until)
    WHERE locked_until IS NOT NULL;
`;

async function migrate() {
  try {
    console.log('[migration 004] audit_log + lockout + otp rate-limit…');
    await db.query(SQL);
    console.log('[migration 004] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 004] ERROR:', err);
    process.exit(1);
  }
}

migrate();
