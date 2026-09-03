-- 2026-09-03 — Condición `sobre_derecho_dga` en el CHECK de alertas.condicion.
--
-- La condición llegó al worker y al formulario el 02-09 (PR #188) sin esta
-- migración: `alertas_condicion_check` la rechazaba con 23514 y tanto
-- "Nueva regla" como POST /api/alertas/por-defecto devolvían 500 al intentar
-- crearla. Se repite el patrón de 2026-06-21-dga-alarmas-conditions.sql:
-- soltar y recrear el CHECK con la lista completa.
--
-- DOWN-MIGRATION: recrear el CHECK sin 'sobre_derecho_dga' tras borrar las
-- filas con esa condición:
--   DELETE FROM alertas WHERE condicion = 'sobre_derecho_dga';

BEGIN;

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
        'review_queue_acumulacion',
        'consumo_diario',
        'sobre_derecho_dga'
    ));

COMMIT;
