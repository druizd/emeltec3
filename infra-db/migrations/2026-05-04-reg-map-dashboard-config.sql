-- Extiende el mapa de variables para que el tecnico configure como se visualiza cada dato.
ALTER TABLE reg_map ADD COLUMN IF NOT EXISTS rol_dashboard VARCHAR(40) DEFAULT 'generico';
ALTER TABLE reg_map ADD COLUMN IF NOT EXISTS transformacion VARCHAR(40) DEFAULT 'directo';
ALTER TABLE reg_map ADD COLUMN IF NOT EXISTS parametros JSONB DEFAULT '{}'::jsonb;

UPDATE reg_map SET rol_dashboard = 'generico' WHERE rol_dashboard IS NULL;
UPDATE reg_map SET transformacion = 'directo' WHERE transformacion IS NULL;
UPDATE reg_map SET parametros = '{}'::jsonb WHERE parametros IS NULL;

CREATE INDEX IF NOT EXISTS idx_regmap_sitio_rol ON reg_map (sitio_id, rol_dashboard);
CREATE INDEX IF NOT EXISTS idx_regmap_sitio_transformacion ON reg_map (sitio_id, transformacion);