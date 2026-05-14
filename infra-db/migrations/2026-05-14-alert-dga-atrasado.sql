-- 2026-05-14 — Nueva condición de alerta `dga_atrasado` para que clientes
-- monitoreen sus reportes DGA. Escalación 24h → 48h → 72h con severidad
-- media/alta/critica (manejada por alerts worker, no por el usuario).

BEGIN;

ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_condicion_check;

ALTER TABLE alertas
    ADD CONSTRAINT alertas_condicion_check
    CHECK (condicion IN ('mayor_que','menor_que','igual_a','fuera_rango','sin_datos','dga_atrasado'));

COMMENT ON COLUMN alertas.condicion IS
    'Condición de la alerta. dga_atrasado evalúa el lag del informante DGA del sitio (24/48/72h → media/alta/critica). variable_key, umbral_bajo y umbral_alto se ignoran para esta condición.';

COMMIT;
