-- 2026-09-23 — Un episodio por incidencia de dga_atrasado, también al escalar.
--
-- Problema: `evaluarAlertaDgaAtrasado` escala por tiers de atraso (media 24h →
-- alta 48h → crítica 72h) insertando una fila nueva en cada escalamiento, sin
-- cerrar las anteriores (esas solo se cerraban al recuperarse, con
-- `resuelta_motivo = 'rearme_automatico'`). Un solo incidente que escaló las
-- 3 veces quedaba como 3 episodios abiertos (ver regla #24 en producción:
-- eventos 428/432/435), mostrándose 3 veces en el resumen semanal del
-- cliente y exigiendo 3 acuses en vez de uno.
--
-- El worker (main-api/src/modules/alerts/worker.ts) ya cierra, desde este
-- deploy, el episodio anterior con `resuelta_motivo = 'escalado'` antes de
-- insertar el de la tier nueva. Esta migración es el backfill: limpia los
-- episodios que ya escalaron antes del fix y quedaron duplicados abiertos.
--
-- Alcance: solo reglas con condicion = 'dga_atrasado'. Entre sus eventos
-- abiertos (resuelta = FALSE), conserva únicamente el más reciente por
-- alerta_id (triggered_at DESC, id DESC para desempatar) y cierra el resto
-- con el mismo motivo que usará el worker de ahora en adelante.
--
-- Idempotente y no-op en una base vacía o ya limpia: si no hay más de un
-- evento abierto por alerta_id, la subconsulta no marca ninguna fila.

BEGIN;

WITH abiertos_dga AS (
    SELECT ae.id,
           ROW_NUMBER() OVER (
               PARTITION BY ae.alerta_id
               ORDER BY ae.triggered_at DESC, ae.id DESC
           ) AS rn
      FROM alertas_eventos ae
      JOIN alertas a ON a.id = ae.alerta_id
     WHERE a.condicion = 'dga_atrasado'
       AND ae.resuelta = FALSE
)
UPDATE alertas_eventos
   SET resuelta = TRUE,
       resuelta_at = NOW(),
       resuelta_motivo = 'escalado'
  FROM abiertos_dga
 WHERE alertas_eventos.id = abiertos_dga.id
   AND abiertos_dga.rn > 1;

COMMENT ON COLUMN alertas_eventos.resuelta_motivo IS
    'Por qué se cerró: manual (alguien lo resolvió en la bandeja), '
    'rearme_automatico (estaba acusado y la condición se normalizó, así que la '
    'regla queda armada para la próxima incidencia) o escalado (dga_atrasado '
    'subió de tier y el episodio anterior de la misma alerta se cierra para '
    'que quede uno solo abierto por incidente). NULL en eventos abiertos.';

COMMIT;
