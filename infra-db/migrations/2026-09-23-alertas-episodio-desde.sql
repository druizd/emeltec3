-- 2026-09-23 — El resumen y la bandeja cuentan la antigüedad desde el
-- incidente, no desde el último escalón.
--
-- Problema: la migración `2026-09-23-alertas-dga-escalado-un-episodio.sql`
-- (y el fix del worker que la acompaña) cierran el episodio anterior con
-- `resuelta_motivo = 'escalado'` cada vez que `dga_atrasado` sube de tier
-- (media 24h → alta 48h → crítica 72h) e insertan uno nuevo. Eso deja UN solo
-- episodio abierto por incidente (el objetivo de esa migración), pero la fila
-- que queda abierta tiene su propio `triggered_at`: el momento en que ESA
-- tier se disparó, no el del inicio real del atraso. El resumen semanal del
-- cliente (`weeklyDigest`) calcula los días con atraso desde `triggered_at`,
-- así que un incidente que lleva 5 días y ya escaló dos veces se mostraba
-- como si llevara solo el tiempo de la última escalada (Pozo 10: 3 días en
-- vez de ~5).
--
-- `episodio_desde` guarda el inicio real del incidente cuando el episodio es
-- la continuación de un escalamiento. NULL significa "el episodio empezó en
-- su propio triggered_at" (nunca escaló, o escaló pero el backfill de abajo
-- no encontró cadena). El worker, desde este deploy, lo llena en cada INSERT
-- de una tier nueva heredando el mínimo entre los episodios que cierra.
--
-- No se toca `triggered_at`: el evaluador sigue leyendo
-- `ORDER BY triggered_at DESC LIMIT 1` para saber la última severidad
-- notificada, y hacer que la fila nueva heredara un triggered_at viejo la
-- empataría o desordenaría contra escalones previos, arriesgando un reescalado
-- en bucle.
--
-- Backfill: para cada episodio DGA abierto que ya escaló antes de este
-- deploy, reconstruye `episodio_desde` a partir de la cadena de eventos
-- cerrados con `resuelta_motivo = 'escalado'` que le pertenecen (los mismos
-- que dejó la migración `2026-09-23-alertas-dga-escalado-un-episodio.sql`).
--
-- Nombrada para que ordene DESPUÉS de esa migración
-- (…-dga-escalado-un-episodio < …-episodio-desde, "d" < "e"), porque el
-- backfill de acá asume que ese cierre ya corrió.
--
-- Idempotente y no-op en una base vacía: sin eventos DGA abiertos, o sin
-- `episodio_desde IS NULL` pendiente, ninguna de las CTE aporta filas.

BEGIN;

ALTER TABLE alertas_eventos
    ADD COLUMN IF NOT EXISTS episodio_desde TIMESTAMPTZ;

COMMENT ON COLUMN alertas_eventos.episodio_desde IS
    'Inicio real del incidente cuando este episodio es la continuación de un '
    'escalamiento (dga_atrasado: media → alta → crítica). NULL = el episodio '
    'empezó en su propio triggered_at (no viene de un escalamiento). '
    'triggered_at NO cambia: sigue siendo el momento de esta tier, porque el '
    'evaluador ordena por él para saber la última severidad notificada.';

WITH abiertos AS (
    -- Episodios DGA todavía abiertos y sin episodio_desde asignado: son los
    -- únicos candidatos a backfill, y la guarda IS NULL hace idempotente
    -- volver a correr esta migración.
    SELECT ae.id, ae.alerta_id, ae.triggered_at
      FROM alertas_eventos ae
      JOIN alertas a ON a.id = ae.alerta_id
     WHERE a.condicion = 'dga_atrasado'
       AND ae.resuelta = FALSE
       AND ae.episodio_desde IS NULL
),
limite AS (
    -- Frontera de la cadena: el evento más reciente de la misma alerta que
    -- NO pertenece a un escalamiento (cerrado manual, rearmado, o abierto de
    -- antes). Antes de esa frontera hay un incidente distinto, así que la
    -- cadena no debe cruzarla. Sin ningún evento así, la frontera es
    -- '-infinity' (toda la historia de la alerta es una sola cadena).
    SELECT ab.id,
           COALESCE(
               (SELECT MAX(o.triggered_at)
                  FROM alertas_eventos o
                 WHERE o.alerta_id = ab.alerta_id
                   AND o.id <> ab.id
                   AND o.resuelta_motivo IS DISTINCT FROM 'escalado'),
               '-infinity'::timestamptz
           ) AS desde
      FROM abiertos ab
),
cadena AS (
    -- Eventos 'escalado' de la misma alerta, entre la frontera y el episodio
    -- abierto: es la cadena de escalamiento que terminó en este episodio.
    -- Sin eventos en ese rango no hay cadena, y el episodio abierto queda sin
    -- tocar (episodio_desde sigue NULL: nunca escaló).
    SELECT ab.id, MIN(c.triggered_at) AS inicio
      FROM abiertos ab
      JOIN limite b ON b.id = ab.id
      JOIN alertas_eventos c
        ON c.alerta_id = ab.alerta_id
       AND c.resuelta_motivo = 'escalado'
       AND c.triggered_at < ab.triggered_at
       AND c.triggered_at > b.desde
     GROUP BY ab.id
)
UPDATE alertas_eventos
   SET episodio_desde = cadena.inicio
  FROM cadena
 WHERE alertas_eventos.id = cadena.id;

COMMIT;
