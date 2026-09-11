-- 2026-08-18 — Destinatarios configurables del monitoreo interno (healthDigest).
--
-- Hasta ahora el worker `healthDigest` mandaba TODO (resumen 07:00/16:00 y los
-- correos de escalación 3h/6h/12h) a un único buzón fijo: la env
-- `MONITOR_PRIMARY_EMAIL`, con default `druiz@emeltec.cl` hardcodeado en el
-- código. Sumar a alguien más al monitoreo exigía editar la env y reiniciar la
-- API. Esta tabla mueve esa lista a la BD para que se administre desde
-- /administration → "Alertas por correo".
--
-- Granularidad por destinatario:
--   recibe_resumen  → los dos digest diarios (incluye el "todo en orden").
--   recibe_eventos  → correo inmediato cuando un sitio escala de tier.
--   umbral_evento   → desde qué tier le llegan los eventos: t3 (>=3h),
--                     t6 (>=6h) o t12 (>=12h). No afecta al resumen.
--   activo          → pausa sin perder la configuración.
--
-- FALLBACK: si esta tabla queda sin filas activas (o la query falla porque la
-- migración no está aplicada), el worker vuelve a `MONITOR_PRIMARY_EMAIL`. El
-- monitoreo nunca queda mudo por una config vacía.
--
-- DOWN-MIGRATION: DROP TABLE health_digest_destinatario;  (el worker vuelve
-- solo al fallback por env, sin cambios de código).

BEGIN;

-- ─── UP ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS health_digest_destinatario (
    email          VARCHAR(150)  PRIMARY KEY,
    nombre         VARCHAR(120),
    recibe_resumen BOOLEAN       NOT NULL DEFAULT TRUE,
    recibe_eventos BOOLEAN       NOT NULL DEFAULT TRUE,
    umbral_evento  VARCHAR(4)    NOT NULL DEFAULT 't3'
                                 CHECK (umbral_evento IN ('t3', 't6', 't12')),
    activo         BOOLEAN       NOT NULL DEFAULT TRUE,
    -- Trazabilidad liviana: id del SuperAdmin que dejó la fila así. Sin FK a
    -- `usuario` a propósito: un destinatario puede ser un correo externo y la
    -- lista debe sobrevivir al borrado de cuentas.
    actualizado_por VARCHAR(10),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE health_digest_destinatario IS
    'Destinatarios del monitoreo interno (worker healthDigest): resumen diario y '
    'escalaciones de sitios sin transmitir / DGA atrasado. El email es la clave y '
    'se guarda siempre en minúsculas (lo normaliza la API). Sin filas activas, el '
    'worker cae a MONITOR_PRIMARY_EMAIL.';

COMMENT ON COLUMN health_digest_destinatario.umbral_evento IS
    'Tier mínimo para recibir correos de escalación: t3 (>=3h sin reportar), '
    't6 (>=6h) o t12 (>=12h). No aplica al resumen diario.';

-- Índice para el filtro del worker (una query por minuto, tabla chica, pero el
-- índice parcial la deja en index-only scan).
CREATE INDEX IF NOT EXISTS idx_health_digest_dest_activo
    ON health_digest_destinatario (email)
    WHERE activo = TRUE;

-- Semilla: preserva el comportamiento actual (el buzón que hoy recibe todo).
-- El nombre se toma de `usuario` si la cuenta existe.
INSERT INTO health_digest_destinatario
    (email, nombre, recibe_resumen, recibe_eventos, umbral_evento, activo)
SELECT
    'druiz@emeltec.cl',
    COALESCE(
        (SELECT NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), '')
           FROM usuario u
          WHERE LOWER(u.email) = 'druiz@emeltec.cl'
          LIMIT 1),
        'Monitoreo Emeltec'
    ),
    TRUE, TRUE, 't3', TRUE
ON CONFLICT (email) DO NOTHING;

COMMIT;
