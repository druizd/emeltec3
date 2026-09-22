-- 2026-09-16 — Un correo por incidencia; el acuse de recibo es lo que rearma.
--
-- Qué estaba pasando: el evento abierto se cerraba solo en cuanto la condición
-- se normalizaba un ciclo (`resuelta_motivo = 'rearme_automatico'`). Cuando la
-- condición volvía ya no había episodio abierto, así que lo único que frenaba el
-- correo era `cooldown_minutos`. Con el default de 60, un equipo que transmite
-- irregular producía UN CORREO POR HORA, indefinidamente.
--
-- Ahora el episodio solo se cierra solo si alguien lo dio por recibido. Sin
-- acuse sigue abierto aunque la condición vaya y venga: las repeticiones se
-- acumulan en la misma fila y la plataforma muestra una sola alerta con las
-- horas que lleva sin resolverse.
--
-- `normalizada_at` es lo que permite distinguir, en esa fila única, entre "el
-- problema sigue ocurriendo" y "ya no ocurre pero nadie lo ha dado por
-- recibido". Se pone al normalizarse y se limpia si la condición vuelve.
--
-- El consolidado de las 08:00/18:00 se retira: la alerta del cliente vuelve a
-- ser inmediata. El volumen no lo causaba la inmediatez sino la repetición.
-- `alertas_digest_envios` y `alertas_eventos.notificado_at` se CONSERVAN: la
-- bitácora de lo ya enviado es historial, y borrarla no se puede deshacer.
--
-- Idempotente y no-op en una base vacía.

BEGIN;

ALTER TABLE alertas_eventos
    ADD COLUMN IF NOT EXISTS normalizada_at TIMESTAMPTZ;

COMMENT ON COLUMN alertas_eventos.normalizada_at IS
    'Desde cuándo la condición dejó de cumplirse dentro de un episodio que sigue '
    'abierto por falta de acuse. NULL = la condición sigue activa (o el episodio '
    'nunca se normalizó). Se limpia si la condición vuelve a dispararse.';

COMMENT ON COLUMN alertas_eventos.resuelta_motivo IS
    'Por qué se cerró: manual (alguien lo resolvió en la bandeja) o '
    'rearme_automatico (estaba acusado y la condición se normalizó, así que la '
    'regla queda armada para la próxima incidencia). NULL en eventos abiertos.';

-- Los episodios que quedaron cerrados por el rearme incondicional anterior no
-- se tocan: ya pasaron, y reabrirlos generaría correo por historia vieja.

COMMIT;
