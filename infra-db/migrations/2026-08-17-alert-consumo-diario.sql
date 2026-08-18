-- 2026-08-17 — Nueva condición de alerta `consumo_diario`. Evalúa el DELTA del
-- totalizador acumulado en el día calendario (America/Santiago), no el valor
-- acumulado del contador.
--
-- Motivación: con `mayor_que` sobre un totalizador, el umbral se compara contra
-- el acumulado histórico del contador (ej. 18.461 m³), así que una regla del
-- tipo "avísame si se consumen más de 300 m³" dispara en el 100% de las
-- lecturas. `consumo_diario` compara contra el consumo del día (ej. 45,1 m³),
-- que es lo que el operador realmente quiere vigilar.
--
-- El delta lo calcula `computeDailyDeltasForVariable` (modules/contadores), que
-- ya aplica la transformación del reg_map — por eso el umbral de esta condición
-- va en unidades de ingeniería (m³), a diferencia de `mayor_que`, que compara
-- el valor CRUDO del payload.
--
-- DOWN-MIGRATION: antes de re-aplicar la restricción anterior, eliminar o
-- migrar las filas que usen el valor nuevo. Si existen filas con
-- condicion = 'consumo_diario', el ADD CONSTRAINT falla por validación — es
-- intencional: bloquea el down para prevenir pérdida de datos.

BEGIN;

-- ─── UP ──────────────────────────────────────────────────────────────────────

-- Esta es la migracion MAS RECIENTE que redefine alertas_condicion_check, asi
-- que es la que valida: las anteriores usan NOT VALID para no reventar el
-- deploy cuando ya existen filas con condiciones que ellas no conocian. Si en
-- el futuro se agrega otra condicion, la migracion nueva debe seguir el mismo
-- patron y ESTA deberia pasar a NOT VALID.
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
        'consumo_diario'
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
    'cooldown_minutos es obligatorio (mínimo recomendado: 60 minutos). '
    'consumo_diario dispara si el DELTA del totalizador en el día calendario '
    '(America/Santiago, parcial mientras el día transcurre) supera umbral_bajo. '
    'variable_key apunta al d1 del reg_map; el delta ya viene transformado, así que '
    'umbral_bajo va en unidades de ingeniería (m³), NO en valor crudo del payload.';

-- ─── DOWN (documentado — ejecutar manualmente con precaución) ─────────────
-- Para revertir, PRIMERO eliminar las filas con el valor nuevo:
--
--   DELETE FROM alertas WHERE condicion = 'consumo_diario';
--
-- LUEGO aplicar:
--
--   ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_condicion_check;
--   ALTER TABLE alertas
--       ADD CONSTRAINT alertas_condicion_check
--       CHECK (condicion IN ('mayor_que','menor_que','igual_a','fuera_rango',
--                            'sin_datos','dga_atrasado','dga_slots_fallidos',
--                            'review_queue_acumulacion'));

COMMIT;
