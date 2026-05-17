-- ============================================================================
-- 2026-05-17 — Bitácora: ficha del sitio + equipamiento
-- ============================================================================
-- Completa las 2 sub-secciones de Bitácora que tenían UI mock:
--   - Ficha del sitio: pin crítico + contactos + acreditaciones + riesgos.
--     Modelado como JSONB en pozo_config para evitar 4 tablas nuevas
--     (esquemas pequeños, poca cardinalidad por sitio).
--   - Equipamiento: inventario físico del sitio (caudalímetros, PLC, UPS,
--     etc). Tabla propia porque hay queries por estado y vencimiento de
--     garantía.
--
-- Idempotente.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- SECCIÓN 1 — Ficha del sitio (JSONB en pozo_config)
-- ---------------------------------------------------------------------------
-- Estructura esperada:
--   {
--     "pin_critico": "Acceso requiere guía DGA — sin agua hasta jul",
--     "contactos": [
--       { "nombre": "Juan Pérez", "rol": "Responsable",
--         "telefono": "+56...", "email": "juan@..." }
--     ],
--     "acreditaciones": [
--       { "persona": "Juan Pérez", "tipo": "DGA",
--         "vigencia_hasta": "2027-01-31" }
--     ],
--     "riesgos": [
--       { "descripcion": "Sin generador respaldo", "probabilidad": 3,
--         "impacto": 4, "mitigacion": "Comprar UPS extendida" }
--     ]
--   }

ALTER TABLE pozo_config
  ADD COLUMN IF NOT EXISTS ficha_critica JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pozo_config.ficha_critica IS
  'Ficha de bitácora del sitio: pin_critico, contactos[], acreditaciones[], '
  'riesgos[]. Modelado JSONB para evitar 4 tablas con poca cardinalidad.';

-- ---------------------------------------------------------------------------
-- SECCIÓN 2 — Equipamiento del sitio
-- ---------------------------------------------------------------------------
-- Inventario físico instalado en el sitio. Distinto al hypertable `equipo`
-- (que es telemetría raw). Acá guardamos metadatos: marca/modelo/serie/
-- compra/garantía/estado.

CREATE TABLE IF NOT EXISTS sitio_equipo (
  id              BIGSERIAL    PRIMARY KEY,
  sitio_id        VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
  nombre          VARCHAR(200) NOT NULL,
  modelo          VARCHAR(150),
  fabricante      VARCHAR(150),
  serie           VARCHAR(100),
  fecha_compra    DATE,
  garantia_hasta  DATE,
  estado          VARCHAR(30)  NOT NULL DEFAULT 'operativo'
                   CHECK (estado IN ('operativo', 'en_mantencion', 'fuera_de_servicio')),
  notas           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sitio_equipo_sitio  ON sitio_equipo (sitio_id);
CREATE INDEX IF NOT EXISTS idx_sitio_equipo_estado ON sitio_equipo (estado)
  WHERE estado <> 'operativo';
CREATE INDEX IF NOT EXISTS idx_sitio_equipo_garantia
  ON sitio_equipo (garantia_hasta)
  WHERE garantia_hasta IS NOT NULL;

COMMENT ON TABLE sitio_equipo IS
  'Inventario físico de equipamiento por sitio. Distinto del hypertable '
  'equipo (telemetría). Usado por la sub-tab Equipamiento de Bitácora.';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='pozo_config' AND column_name='ficha_critica') THEN
    RAISE EXCEPTION 'pozo_config.ficha_critica no se creó';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sitio_equipo') THEN
    RAISE EXCEPTION 'sitio_equipo no se creó';
  END IF;
  RAISE NOTICE 'Bitácora ficha+equipos: OK';
END $$;

COMMIT;
