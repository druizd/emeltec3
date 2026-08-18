-- 2026-08-18 — Marca de agua para las alertas automáticas de auditoría.
--
-- Problema: `detectarCambiosRol()` consulta audit_log con una ventana FIJA de
-- 24 horas y se protege con un cooldown de AUDIT_ALERT_COOLDOWN_MINUTES (60 por
-- defecto). Las dos cosas no son compatibles: el cambio de rol sigue dentro de
-- la ventana mucho después de que el cooldown expira, así que la MISMA alerta
-- se reenvía cada hora, a todos los SuperAdmin, durante 24 horas.
--
-- Caso real (18-08-2026): un solo cambio de rol a las 04:52 UTC generó 14
-- correos por hora — uno por SuperAdmin activo — durante toda la mañana.
--
-- El cooldown por tiempo es la herramienta equivocada para una ventana larga:
-- lo que hace falta es recordar HASTA DÓNDE se alertó. `watermark_ts` guarda el
-- `ts` más nuevo de audit_log que ya viajó en una alerta; la detección solo mira
-- lo posterior. El cooldown se queda como límite de frecuencia, que es lo que sí
-- sabe hacer.
--
-- NULL = sin marca de agua. Pasa en dos casos: la clave es nueva, o la alerta no
-- usa marca porque no la necesita (`logins_fallidos` tiene una ventana de 15 min,
-- más corta que el cooldown, así que sus filas expiran antes de poder repetirse).
-- En ambos rige el piso de la ventana de la consulta.
--
-- La tabla se crea acá porque nació en el sistema de migraciones legacy de
-- main-api (`migrations/007_retention_fields.js`), que el deploy ya no ejecuta:
-- no existía en infra-db, así que ni CI ni un entorno nuevo la tenían.

BEGIN;

CREATE TABLE IF NOT EXISTS audit_alert_cooldown (
    id           SERIAL       PRIMARY KEY,
    alert_key    VARCHAR(120) NOT NULL UNIQUE,
    last_sent_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_alert_cooldown_key
    ON audit_alert_cooldown (alert_key);

ALTER TABLE audit_alert_cooldown
    ADD COLUMN IF NOT EXISTS watermark_ts TIMESTAMPTZ;

COMMENT ON COLUMN audit_alert_cooldown.watermark_ts IS
    'ts más nuevo de audit_log ya incluido en una alerta enviada para esta clave. '
    'La detección solo considera filas posteriores. NULL = sin marca, rige el piso '
    'de la ventana de la consulta.';

-- Las claves que ya existen se dan por alertadas hasta su último envío: sin esto
-- el primer ciclo tras el deploy repetiría una vez más lo que ya se notificó
-- (que es justo el correo que esta migración viene a cortar).
UPDATE audit_alert_cooldown
   SET watermark_ts = last_sent_at
 WHERE watermark_ts IS NULL;

COMMIT;
