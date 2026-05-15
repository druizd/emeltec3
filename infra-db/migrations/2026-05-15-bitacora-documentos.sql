-- 2026-05-15 — Bitácora de documentos: metadata de archivos subidos a Azure
-- Blob Storage. El binario vive en el container Blob, solo metadata en BD.

BEGIN;

CREATE TABLE IF NOT EXISTS documentos (
    id              BIGSERIAL    PRIMARY KEY,
    sitio_id        VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
    empresa_id      VARCHAR(10)  NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    sub_empresa_id  VARCHAR(10)  REFERENCES sub_empresa(id) ON DELETE SET NULL,
    titulo          VARCHAR(200) NOT NULL,
    tipo            VARCHAR(30)  NOT NULL DEFAULT 'otro'
                     CHECK (tipo IN ('ficha_tecnica','datasheet','certificado','manual','plano','otro')),
    descripcion     TEXT,
    blob_path       VARCHAR(500) NOT NULL UNIQUE,
    nombre_original VARCHAR(255) NOT NULL,
    mime            VARCHAR(120) NOT NULL,
    size_bytes      BIGINT       NOT NULL,
    version         VARCHAR(30)  DEFAULT '1.0',
    fecha_vigencia  DATE,
    uploaded_by     VARCHAR(10)  REFERENCES usuario(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documentos_sitio   ON documentos (sitio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_empresa ON documentos (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_tipo    ON documentos (tipo, created_at DESC);

COMMENT ON TABLE  documentos IS 'Metadata de documentos almacenados en Azure Blob Storage (bitácora del sitio).';
COMMENT ON COLUMN documentos.blob_path IS 'Path completo dentro del container Blob, ej: SIT001/<uuid>-<filename>.pdf';

COMMIT;
