-- Site type and well-specific manual configuration.
-- Safe to run multiple times.

ALTER TABLE sitio
  ADD COLUMN IF NOT EXISTS tipo_sitio VARCHAR(30) NOT NULL DEFAULT 'pozo';

ALTER TABLE sitio
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS pozo_config (
  sitio_id                 VARCHAR(10) PRIMARY KEY REFERENCES sitio(id) ON DELETE CASCADE,
  profundidad_pozo_m       NUMERIC,
  profundidad_sensor_m     NUMERIC,
  nivel_estatico_manual_m  NUMERIC,
  obra_dga                 VARCHAR(80),
  slug                     VARCHAR(120),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pozo_config_sitio ON pozo_config (sitio_id);
