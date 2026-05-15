-- 2026-05-15 — Bitácora de incidencias: registro de eventos operacionales
-- (mantenciones, fallas, intervenciones) por sitio. Vincula opcionalmente
-- con un evento de alerta (alertas_eventos.id) para cerrar el loop de la
-- bandeja de alertas → incidencia formal.

BEGIN;

CREATE TABLE IF NOT EXISTS incidencias (
    id                BIGSERIAL    PRIMARY KEY,
    sitio_id          VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
    empresa_id        VARCHAR(10)  NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    sub_empresa_id    VARCHAR(10)  REFERENCES sub_empresa(id) ON DELETE SET NULL,
    titulo            VARCHAR(200) NOT NULL,
    descripcion       TEXT,
    origen            VARCHAR(20)  NOT NULL DEFAULT 'remota'
                       CHECK (origen IN ('terreno','remota')),
    categoria         VARCHAR(20)  NOT NULL DEFAULT 'otro'
                       CHECK (categoria IN ('sensor','comunicacion','mecanico','electrico','otro')),
    gravedad          VARCHAR(20)  NOT NULL DEFAULT 'media'
                       CHECK (gravedad IN ('leve','media','critica')),
    estado            VARCHAR(20)  NOT NULL DEFAULT 'abierta'
                       CHECK (estado IN ('abierta','en_progreso','resuelta','cerrada')),
    tecnico_id        VARCHAR(10)  REFERENCES usuario(id) ON DELETE SET NULL,
    alerta_evento_id  INTEGER      REFERENCES alertas_eventos(id) ON DELETE SET NULL,
    creado_por        VARCHAR(10)  REFERENCES usuario(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    cerrado_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidencias_sitio    ON incidencias (sitio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_empresa  ON incidencias (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_estado   ON incidencias (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_alerta_evt
    ON incidencias (alerta_evento_id) WHERE alerta_evento_id IS NOT NULL;

COMMENT ON TABLE  incidencias IS 'Bitácora de incidencias operacionales por sitio. Puede originarse desde una alerta (alerta_evento_id).';
COMMENT ON COLUMN incidencias.origen           IS 'terreno = registrada en sitio físico; remota = registrada vía plataforma.';
COMMENT ON COLUMN incidencias.alerta_evento_id IS 'FK opcional al evento de alerta que originó la incidencia.';

COMMIT;
