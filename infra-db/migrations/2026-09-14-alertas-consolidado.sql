-- 2026-09-14 — Consolidado de alertas por correo y aviso único por episodio.
--
-- Problema: con un evento abierto SIN reconocer, el worker volvía a disparar
-- cada `cooldown_minutos` (60 por defecto en las reglas por defecto), y cada
-- disparo mandaba un correo por destinatario y por regla. Seis pozos con
-- problema = seis correos por hora, para siempre, hasta que alguien entrara a
-- la plataforma a reconocer uno por uno.
--
-- Ahora:
--   1. Un aviso por episodio. El evento abierto agrupa las repeticiones esté
--      reconocido o no, y se rearma solo cuando la condición se normaliza
--      (`resuelta_motivo = 'rearme_automatico'`, para distinguirlo del cierre
--      manual en la bandeja).
--   2. Las severidades no críticas no mandan correo al momento: quedan en cola
--      (`notificado = FALSE`) y salen juntas en el consolidado de las 08:00 y
--      18:00 (hora de pared de Chile).
--   3. Re-aviso diario: un evento que sigue abierto vuelve a aparecer en el
--      consolidado cuando pasaron más de ALERT_DIGEST_REPEAT_HOURS desde el
--      último aviso. `notificado_at` es la marca que lo permite; antes solo
--      existía el booleano `notificado`.

BEGIN;

ALTER TABLE alertas_eventos
    ADD COLUMN IF NOT EXISTS notificado_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resuelta_motivo TEXT;

COMMENT ON COLUMN alertas_eventos.notificado_at IS
    'Última vez que este evento salió en un correo (inmediato o consolidado). '
    'Es la base del re-aviso diario: NULL = sigue en la cola del consolidado.';
COMMENT ON COLUMN alertas_eventos.resuelta_motivo IS
    'Por qué se cerró: manual (alguien lo resolvió en la bandeja) o '
    'rearme_automatico (la condición se normalizó y el worker lo cerró para '
    'poder volver a avisar la próxima vez). NULL en eventos abiertos.';

-- Backfill: los eventos ya notificados no tienen marca de cuándo. Se usa
-- `triggered_at`, que es el instante en que se mandó el correo (el envío es
-- parte de la misma transacción lógica del insert). Sin esto, el primer
-- consolidado después del deploy re-avisaría TODO el histórico abierto.
UPDATE alertas_eventos
   SET notificado_at = triggered_at
 WHERE notificado = TRUE
   AND notificado_at IS NULL;

-- Cola del consolidado: eventos que todavía no salieron en ningún correo.
CREATE INDEX IF NOT EXISTS idx_alertas_eventos_cola_digest
    ON alertas_eventos (triggered_at)
    WHERE notificado = FALSE;

-- Re-aviso diario: eventos abiertos ordenados por último aviso.
CREATE INDEX IF NOT EXISTS idx_alertas_eventos_reaviso
    ON alertas_eventos (notificado_at)
    WHERE resuelta = FALSE;

-- Bitácora de envíos del consolidado. La PK por slot es lo que impide mandarlo
-- dos veces: si el proceso se reinicia entre el envío y el registro, el slot
-- sigue pendiente y se reintenta; si ya está registrado, no se repite. Es
-- además lo que hace el envío idempotente ante dos réplicas del worker.
CREATE TABLE IF NOT EXISTS alertas_digest_envios (
    slot_ts          TIMESTAMPTZ  PRIMARY KEY,
    enviado_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    eventos_nuevos   INTEGER      NOT NULL DEFAULT 0,
    eventos_reaviso  INTEGER      NOT NULL DEFAULT 0,
    destinatarios    INTEGER      NOT NULL DEFAULT 0
);

-- CREATE TABLE IF NOT EXISTS no agrega columnas a una tabla que ya existe.
ALTER TABLE alertas_digest_envios
    ADD COLUMN IF NOT EXISTS eventos_nuevos  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS eventos_reaviso INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS destinatarios   INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE alertas_digest_envios IS
    'Un registro por slot de consolidado ya enviado (08:00 y 18:00 hora Chile). '
    'La PK es el candado contra envíos duplicados.';

COMMIT;
