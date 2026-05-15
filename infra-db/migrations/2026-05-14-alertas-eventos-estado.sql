-- 2026-05-14 — Estados extendidos para alertas_eventos: reconocida,
-- asignada, vinculada a incidencia. Permite que la bandeja de alertas
-- gestione el ciclo de vida completo: activa → reconocida → asignada → resuelta.

BEGIN;

ALTER TABLE alertas_eventos
    ADD COLUMN IF NOT EXISTS reconocida_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reconocida_por VARCHAR(10) REFERENCES usuario(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS asignado_a     VARCHAR(10) REFERENCES usuario(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS asignado_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS incidencia_id  VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_alertas_eventos_asignado
    ON alertas_eventos (asignado_a)
    WHERE asignado_a IS NOT NULL;

COMMENT ON COLUMN alertas_eventos.reconocida_at  IS 'Marca de tiempo cuando un operador reconoció el evento.';
COMMENT ON COLUMN alertas_eventos.reconocida_por IS 'Usuario que reconoció el evento.';
COMMENT ON COLUMN alertas_eventos.asignado_a     IS 'Usuario responsable de resolver el evento.';
COMMENT ON COLUMN alertas_eventos.asignado_at    IS 'Marca de tiempo cuando se asignó el responsable.';
COMMENT ON COLUMN alertas_eventos.incidencia_id  IS 'Identificador de incidencia vinculada (texto libre, ej INC-0018).';

COMMIT;
