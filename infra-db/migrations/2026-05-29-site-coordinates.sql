-- 2026-05-29 — Coordenadas UTM del sitio.
--
-- Antes: solo había `ubicacion VARCHAR(255)` como texto libre. El mapa de la
-- vista general usaba mocks hardcoded porque no podía leer coords del DB.
--
-- Agregamos UTM (estándar en Chile para minería/agua/electricidad):
--   - coord_norte: northing en metros (NUMERIC ~14 dígitos para cubrir
--     valores hasta 10 millones con precisión de cm).
--   - coord_este:  easting en metros.
--   - huso:        zona UTM (Chile usa 18, 19 o 20 según latitud).
--
-- WGS84 implícito (datum más usado). Conversión a lat/lng la hace el
-- frontend con proj4js para plotear en mapa satelital.
--
-- NULLABLE porque sitios legacy no tienen coords — frontend tiene fallback
-- (centro de Coquimbo) cuando falta alguno.
--
-- IDEMPOTENCIA: scripts/deploy-production.sh re-aplica todas las
-- migrations en cada deploy. `IF NOT EXISTS` para safe re-run.

ALTER TABLE sitio
    ADD COLUMN IF NOT EXISTS coord_norte NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS coord_este  NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS huso        SMALLINT;

-- Constraint suave: huso debe estar entre 1 y 60 (UTM válido).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sitio_huso_valid'
    ) THEN
        ALTER TABLE sitio ADD CONSTRAINT sitio_huso_valid
            CHECK (huso IS NULL OR (huso BETWEEN 1 AND 60));
    END IF;
END$$;

COMMENT ON COLUMN sitio.coord_norte IS 'UTM northing en metros. WGS84.';
COMMENT ON COLUMN sitio.coord_este  IS 'UTM easting en metros. WGS84.';
COMMENT ON COLUMN sitio.huso        IS 'Zona UTM (1-60). Chile usa 18 (norte), 19 (centro) o 20 (sur).';
