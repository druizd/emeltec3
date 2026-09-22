-- Alerta "Sin comunicación": la ventana se mide en horas.
--
-- La ventana de detección era `cooldown_minutos`, el mismo número que hace de
-- anti-flapping: 60 minutos por default, o sea que un pozo gritaba a la hora de
-- no transmitir, y el mensaje decía siempre "hace más de 60 minutos" aunque
-- llevara días mudo. Ahora la ventana vive en `umbral_bajo`, EN HORAS, y el
-- cooldown queda solo como anti-flapping.
--
-- Criterio del backfill:
--   * severidad: `critica` → `alta`, para que coincida con la regla recomendada.
--     Desde el 16-09-2026 la severidad ya no decide si el correo sale al
--     instante —todas salen al instante, una sola vez por incidencia—: solo
--     ordena y colorea.
--   * ventana: las que siguen en el default de 60 min pasan a 12 h, que es el
--     umbral acordado para dar un pozo por desconectado. Las que alguien afinó
--     a mano conservan su ventana actual, expresada en horas — bajarle el
--     umbral a nadie, pero tampoco estirarle a 12 h una regla que pidieron
--     corta a propósito.
--
-- Idempotente y no-op en una base vacía (CI aplica todas las migraciones sobre
-- el esquema base sin datos).

BEGIN;

-- Ventana de detección, en horas. Solo donde todavía no hay una.
UPDATE alertas
   SET umbral_bajo = CASE
         WHEN cooldown_minutos = 60 THEN 12
         ELSE GREATEST(ROUND((cooldown_minutos / 60.0)::NUMERIC, 2), 0.05)
       END,
       updated_at  = NOW()
 WHERE condicion = 'sin_datos'
   AND umbral_bajo IS NULL;

-- Severidad alineada con la regla recomendada.
UPDATE alertas
   SET severidad  = 'alta',
       updated_at = NOW()
 WHERE condicion = 'sin_datos'
   AND severidad = 'critica';

-- La descripción por defecto hablaba de minutos.
UPDATE alertas
   SET descripcion = 'El equipo lleva más de ' ||
                     trim(to_char(umbral_bajo, 'FM999999990.99')) ||
                     ' horas sin transmitir.',
       updated_at  = NOW()
 WHERE condicion = 'sin_datos'
   AND descripcion = 'El equipo lleva más de 60 minutos sin transmitir.'
   AND umbral_bajo IS NOT NULL;

COMMIT;
