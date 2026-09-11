-- 2026-05-14 — Nueva condición de alerta `dga_atrasado` para que clientes
-- monitoreen sus reportes DGA. Escalación 24h → 48h → 72h con severidad
-- media/alta/critica (manejada por alerts worker, no por el usuario).

BEGIN;

ALTER TABLE alertas DROP CONSTRAINT IF EXISTS alertas_condicion_check;

-- NOT VALID: este archivo se reaplica en CADA deploy (deploy-production.sh
-- recorre infra-db/migrations/*.sql completo) y su lista de condiciones es la
-- de esta fecha. Cuando una migracion POSTERIOR agrega condiciones y ya hay
-- filas usandolas, recrear el constraint aca fallaba con "check constraint
-- ... is violated by some row" y abortaba el deploy entero (psql con
-- ON_ERROR_STOP devuelve exit 3). Paso en produccion el 2026-08-17 con una
-- regla ya migrada a 'consumo_diario'.
--
-- NOT VALID hace que el constraint rija para las filas nuevas sin revalidar
-- las existentes. La migracion mas reciente que redefine este mismo constraint
-- SI valida, con la lista completa, y es la que deja el estado final correcto.

ALTER TABLE alertas
    ADD CONSTRAINT alertas_condicion_check
    CHECK (condicion IN ('mayor_que','menor_que','igual_a','fuera_rango','sin_datos','dga_atrasado'))
    NOT VALID;

COMMENT ON COLUMN alertas.condicion IS
    'Condición de la alerta. dga_atrasado evalúa el lag del informante DGA del sitio (24/48/72h → media/alta/critica). variable_key, umbral_bajo y umbral_alto se ignoran para esta condición.';

COMMIT;
