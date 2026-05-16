-- 2026-05-15 — Agregado mensual de contadores (totalizador agua, energia electrica,
-- volumen riles, etc.). Una fila por (sitio, variable, mes) con el delta consumido.
--
-- El worker (main-api/src/modules/contadores/worker.ts) recalcula mes_actual y
-- mes_anterior cada hora. El backfill inicial lo hace un script CLI sobre los
-- ultimos 36 meses por sitio.
--
-- Disenado para ser generico: cualquier variable cuyo rol_dashboard este en la
-- lista COUNTER_ROLES del servicio se agrega aqui. Permite que el mismo endpoint
-- sirva "Flujo Mensual" para pozo (m3) y "Consumo Mensual" para electrico (kWh).

BEGIN;

CREATE TABLE IF NOT EXISTS site_contador_mensual (
    sitio_id            VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
    variable_id         VARCHAR(20)  NOT NULL REFERENCES reg_map(id) ON DELETE CASCADE,
    rol                 VARCHAR(40)  NOT NULL,
    mes                 DATE         NOT NULL,
    valor_inicio        NUMERIC,
    valor_fin           NUMERIC,
    delta               NUMERIC,
    unidad              VARCHAR(16),
    muestras            INTEGER      NOT NULL DEFAULT 0,
    resets_detectados   INTEGER      NOT NULL DEFAULT 0,
    ultimo_dato         TIMESTAMPTZ,
    actualizado_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sitio_id, variable_id, mes)
);

CREATE INDEX IF NOT EXISTS idx_contador_mensual_sitio_rol_mes
    ON site_contador_mensual (sitio_id, rol, mes DESC);
CREATE INDEX IF NOT EXISTS idx_contador_mensual_mes
    ON site_contador_mensual (mes DESC);

COMMENT ON TABLE  site_contador_mensual IS
    'Agregado mensual generico de variables tipo contador (totalizador, energia, volumen). Una fila por (sitio, variable, mes).';
COMMENT ON COLUMN site_contador_mensual.rol IS
    'rol_dashboard de reg_map al momento de agregar. Redundante para queries rapidas sin join.';
COMMENT ON COLUMN site_contador_mensual.delta IS
    'Consumo del mes = valor_fin - valor_inicio, sumando segmentos cuando hay resets.';
COMMENT ON COLUMN site_contador_mensual.resets_detectados IS
    'Veces que el contador retrocedio dentro del mes (overflow uint32, reemplazo de sensor).';
COMMENT ON COLUMN site_contador_mensual.ultimo_dato IS
    'Timestamp de la ultima lectura considerada. Util para detectar mes incompleto.';

COMMIT;
