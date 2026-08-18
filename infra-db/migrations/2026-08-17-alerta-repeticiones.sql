-- 2026-08-17 — Agrupación de repeticiones en alertas_eventos.
--
-- Problema: el worker vuelve a disparar cada `cooldown_minutos` mientras la
-- condición siga cumpliéndose, sin importar que un operador ya haya reconocido
-- el evento. Una regla mal configurada (o una condición que no se normaliza
-- sola, como un totalizador acumulado) genera un evento y un correo cada 5
-- minutos: 576 por fin de semana.
--
-- Con estas columnas, reconocer un evento pasa a significar "ya lo sé": el
-- worker deja de crear eventos nuevos y de notificar, y solo incrementa el
-- contador del evento reconocido. Así la bandeja muestra 1 pendiente en vez de
-- 576, pero queda registro de que la condición siguió activa y por cuánto.
--
-- El rearme lo hace el worker: si la condición se normaliza y el evento estaba
-- reconocido, lo resuelve automáticamente, de modo que la próxima vez que
-- ocurra vuelva a avisar.

BEGIN;

ALTER TABLE alertas_eventos
    ADD COLUMN IF NOT EXISTS repeticiones         INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ultima_repeticion_at TIMESTAMPTZ;

COMMENT ON COLUMN alertas_eventos.repeticiones IS
    'Veces que la condición volvió a cumplirse mientras el evento estaba reconocido. '
    '0 = no se repitió desde que se reconoció (o nadie lo ha reconocido todavía).';
COMMENT ON COLUMN alertas_eventos.ultima_repeticion_at IS
    'Marca de tiempo de la última repetición agrupada. NULL si nunca se repitió.';

-- El worker busca el evento abierto más reciente por alerta en cada ciclo
-- (cada 60s, por cada regla activa).
CREATE INDEX IF NOT EXISTS idx_alertas_eventos_abierto
    ON alertas_eventos (alerta_id, triggered_at DESC)
    WHERE resuelta = FALSE;

COMMIT;
