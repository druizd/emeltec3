-- 2026-06-21 — Nuevas condiciones de alerta DGA: dga_slots_fallidos y
-- review_queue_acumulacion. Extiende el CHECK de alertas.condicion y documenta
-- el reuso de umbral_bajo como umbral N para review_queue_acumulacion (ADR-5).
--
-- DOWN-MIGRATION: antes de re-aplicar la restricción de 6 valores, eliminar
-- o migrar cualquier fila de alertas que use los dos nuevos valores. Si existen
-- filas con condicion IN ('dga_slots_fallidos','review_queue_acumulacion') al
-- momento de ejecutar el down, el constraint falla por validación — esto es
-- intencional: el down queda bloqueado para prevenir pérdida de datos (spec
-- §"Down-migration blocked when rows exist").

BEGIN;

-- ─── UP ──────────────────────────────────────────────────────────────────────

ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_condicion_check;

ALTER TABLE alertas
    ADD CONSTRAINT alertas_condicion_check
    CHECK (condicion IN (
        'mayor_que',
        'menor_que',
        'igual_a',
        'fuera_rango',
        'sin_datos',
        'dga_atrasado',
        'dga_slots_fallidos',
        'review_queue_acumulacion'
    ));

COMMENT ON COLUMN alertas.condicion IS
    'Condición de la alerta. '
    'dga_atrasado evalúa el lag del informante DGA del sitio (24/48/72h → media/alta/critica); '
    'variable_key, umbral_bajo y umbral_alto se ignoran para esta condición. '
    'dga_slots_fallidos dispara si el sitio tiene >= 1 slot dato_dga en estado fallido '
    '(el worker cuenta todos los slots con estatus=''fallido'' para el site_id). '
    'review_queue_acumulacion dispara si la cola de slots requires_review del sitio supera '
    'el umbral N — N se lee de umbral_bajo (columna reutilizada; ver ADR-5). '
    'Para las tres condiciones DGA, id_serial y equipo se ignoran; '
    'cooldown_minutos es obligatorio (mínimo recomendado: 60 minutos).';

-- ─── DOWN (documentado — ejecutar manualmente con precaución) ─────────────
-- Para revertir, PRIMERO eliminar filas con los valores nuevos:
--
--   DELETE FROM alertas
--    WHERE condicion IN ('dga_slots_fallidos', 'review_queue_acumulacion');
--
-- LUEGO aplicar:
--
--   ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_condicion_check;
--   ALTER TABLE alertas
--       ADD CONSTRAINT alertas_condicion_check
--       CHECK (condicion IN ('mayor_que','menor_que','igual_a','fuera_rango',
--                            'sin_datos','dga_atrasado'));
--
-- Si existen filas con los valores nuevos y NO se eliminan primero,
-- el ADD CONSTRAINT fallará por violación de CHECK (comportamiento correcto,
-- protege los datos).

COMMIT;
