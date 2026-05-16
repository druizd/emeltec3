-- 2026-05-16 — Config de operacion por sitio: turnos (2 o 3) + jornada (inicio/fin).
-- Compartido entre todos los usuarios del sitio. Se edita desde la pestaña
-- "Hoy en tiempo real" (sub-config de turnos) y "Graficos historicos" (jornada
-- 07-07 ajustable).
--
-- Una sola fila por sitio. Defaults aplican si nunca se ha customizado.

BEGIN;

CREATE TABLE IF NOT EXISTS site_operacion_config (
    sitio_id        VARCHAR(10) PRIMARY KEY REFERENCES sitio(id) ON DELETE CASCADE,
    num_turnos      SMALLINT    NOT NULL DEFAULT 3 CHECK (num_turnos IN (2, 3)),
    turnos          JSONB       NOT NULL DEFAULT '[
        {"nombre":"Turno 1","inicio":"07:00","fin":"14:59"},
        {"nombre":"Turno 2","inicio":"15:00","fin":"22:59"},
        {"nombre":"Turno 3","inicio":"23:00","fin":"06:59"}
    ]'::jsonb,
    jornada_inicio  VARCHAR(5)  NOT NULL DEFAULT '07:00' CHECK (jornada_inicio ~ '^\d{2}:\d{2}$'),
    jornada_fin     VARCHAR(5)  NOT NULL DEFAULT '07:00' CHECK (jornada_fin ~ '^\d{2}:\d{2}$'),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  site_operacion_config IS
    'Config por sitio de turnos y jornada para la pestaña de Operacion. Compartido entre operadores.';
COMMENT ON COLUMN site_operacion_config.num_turnos IS
    'Cantidad de turnos activos (2 o 3). El array `turnos` siempre trae los 3 nombres/horarios pero solo se renderizan los primeros num_turnos.';
COMMENT ON COLUMN site_operacion_config.turnos IS
    'JSONB array de objetos {nombre,inicio,fin}. inicio/fin formato HH:MM.';
COMMENT ON COLUMN site_operacion_config.jornada_inicio IS
    'Hora de inicio de jornada operacional (default 07:00). Usada en el grafico Resumen Operacional.';
COMMENT ON COLUMN site_operacion_config.jornada_fin IS
    'Hora de fin de jornada. Si jornada_fin <= jornada_inicio, la jornada cruza medianoche.';

COMMIT;
