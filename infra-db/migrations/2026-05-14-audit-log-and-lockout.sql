-- 2026-05-14 — Cumplimiento Ley 21.663 (Marco Ciberseguridad) + Ley 21.719 (Datos Personales).
-- 1. audit_log: bitácora persistente de acciones críticas (login, CRUD usuarios/empresas/alertas).
-- 2. usuario.failed_logins + usuario.locked_until: bloqueo tras intentos fallidos.
-- 3. usuario.otp_requests_count + usuario.otp_requests_window_start: rate limit OTP por email.

BEGIN;

-- ── 1. audit_log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    ts              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actor_id        VARCHAR(10),                     -- usuario.id; NULL si pre-auth
    actor_email     VARCHAR(150),                    -- denormalizado: persiste tras DELETE usuario
    actor_tipo      VARCHAR(30),                     -- rol al momento de la acción
    action          VARCHAR(60)  NOT NULL,           -- e.g. 'login.success', 'usuario.update'
    target_type     VARCHAR(40),                     -- 'usuario', 'alerta', 'empresa'
    target_id       VARCHAR(40),                     -- id del recurso afectado
    payload_hash    VARCHAR(64),                     -- sha256 del body de la mutación (no almacenamos PII)
    ip              VARCHAR(45),                     -- IPv4 o IPv6
    user_agent      VARCHAR(255),
    status_code     INTEGER,                         -- HTTP status response
    metadata        JSONB                            -- campos extra (e.g. reason de fallo)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts          ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor       ON audit_log (actor_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action      ON audit_log (action, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target      ON audit_log (target_type, target_id, ts DESC);

COMMENT ON TABLE  audit_log IS 'Bitácora de acciones críticas. Append-only. Retención mínima recomendada 1 año (Ley 21.663).';
COMMENT ON COLUMN audit_log.payload_hash IS 'sha256 hex del body normalizado. No persiste contenido — evita filtrar PII al consultar la bitácora.';

-- ── 2. Lockout en usuario ─────────────────────────────────────────────────────
ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS failed_logins   INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_login_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_login_ip   VARCHAR(45);

CREATE INDEX IF NOT EXISTS idx_usuario_locked_until ON usuario (locked_until)
    WHERE locked_until IS NOT NULL;

COMMENT ON COLUMN usuario.failed_logins  IS 'Intentos fallidos consecutivos. Se resetea tras login exitoso o cuando locked_until expira.';
COMMENT ON COLUMN usuario.locked_until   IS 'Cuenta bloqueada hasta este timestamp. NULL = no bloqueada.';

-- ── 3. Rate limit OTP por email ──────────────────────────────────────────────
ALTER TABLE usuario
    ADD COLUMN IF NOT EXISTS otp_requests_count        INTEGER      NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS otp_requests_window_start TIMESTAMPTZ;

COMMENT ON COLUMN usuario.otp_requests_count        IS 'Solicitudes OTP en la ventana actual. Resetea cuando window expira.';
COMMENT ON COLUMN usuario.otp_requests_window_start IS 'Inicio ventana sliding rate-limit. Resetear a NOW() cuando se reinicie.';

COMMIT;
