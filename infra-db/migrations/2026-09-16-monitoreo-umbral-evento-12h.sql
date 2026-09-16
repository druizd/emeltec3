-- 2026-09-16 — El monitoreo avisa desde las 12 h, no desde las 3 h.
--
-- `umbral_evento` decide desde qué tramo le llegan los correos de escalación a
-- cada destinatario del monitoreo interno (healthDigest). Nació en 't3': un
-- aviso apenas un equipo lleva 3 horas sin reportar. En la práctica un hueco de
-- 3 h es ruido —señal celular intermitente, una mantención corta— y lo que
-- importa es el equipo que no vuelve. Decisión del usuario el 16-09-2026, junto
-- con el mismo umbral de 12 h para la alerta `sin_datos` de los pozos
-- (ver 2026-09-16-sin-datos-en-horas.sql).
--
-- Lo que sigue en 't3' ahora no es un default olvidado sino una elección: el
-- resumen de las 06:00/15:00 no cambia, y ahí aparecen igual los tramos de 3 h
-- y 6 h. Esto solo mueve el correo inmediato.
--
-- RE-EJECUCIÓN: el deploy aplica TODAS las migraciones en cada despliegue, así
-- que un UPDATE sin guardia le pisaría el umbral a quien lo baje después desde
-- la pantalla. La guardia es `updated_at`: la API escribe NOW() en cada fila al
-- guardar /administration → "Alertas por correo", así que una vez que una
-- persona tocó esa pantalla, esta migración deja de alcanzarla para siempre.
--
-- Idempotente y no-op en una base vacía (CI aplica todo sobre el esquema base
-- sin datos).

BEGIN;

-- Default para destinatarios nuevos.
ALTER TABLE health_digest_destinatario
    ALTER COLUMN umbral_evento SET DEFAULT 't12';

-- Filas existentes que nunca se editaron desde la pantalla.
UPDATE health_digest_destinatario
   SET umbral_evento = 't12'
 WHERE umbral_evento = 't3'
   AND updated_at < TIMESTAMPTZ '2026-09-16 00:00:00-04';

COMMENT ON COLUMN health_digest_destinatario.umbral_evento IS
    'Tier mínimo para recibir correos de escalación: t3 (>=3h sin reportar), '
    't6 (>=6h) o t12 (>=12h). Default t12 desde el 16-09-2026. No aplica al '
    'resumen diario, que informa los tres tramos igual.';

COMMIT;
