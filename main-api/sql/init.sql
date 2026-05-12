-- ============================================================================
-- init.sql — Schema para main-api (Emeltec)
-- Requiere: PostgreSQL 14+ con extensión TimescaleDB
--
-- ⚠️ DEPRECATED — Este archivo está DESACTUALIZADO respecto al schema real
--    en producción. El código del backend consulta la tabla `equipo` con
--    columna `id_serial`, NO las hipertablas `ts_agua/ts_electrico/ts_pozos`
--    definidas aquí. El schema vivo se mantiene en `infra-db/`.
--    Mantener este archivo sólo como referencia histórica.
-- ============================================================================

-- 1. Habilitar TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================================
-- 2. Catálogo de dominios
--    Cada dominio representa un área de la operación (agua, eléctrico, pozos).
--    Agregar un dominio nuevo es simplemente INSERT + crear su hypertable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS domains (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(50)  UNIQUE NOT NULL,   -- ej: 'agua', 'electrico', 'pozos'
  name        VARCHAR(100) NOT NULL,          -- ej: 'Sistema de Agua'
  description TEXT,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Dominios iniciales (puedes agregar más después)
INSERT INTO domains (slug, name, description) VALUES
  ('agua',       'Sistema de Agua',      'Monitoreo de pozos, bombas y caudal'),
  ('electrico',  'Sistema Eléctrico',    'Monitoreo de tableros, consumos y generación'),
  ('pozos',      'Pozos',                'Monitoreo de nivel, presión y temperatura de pozos')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- 3. Catálogo de dispositivos (PLCs, RTUs, sensores)
--    Cada dispositivo pertenece a un dominio.
-- ============================================================================
CREATE TABLE IF NOT EXISTS devices (
  id          SERIAL PRIMARY KEY,
  serial_id   VARCHAR(100) UNIQUE NOT NULL,   -- ej: '151.21.49.121' o MAC address
  domain_id   INTEGER      NOT NULL REFERENCES domains(id),
  name        VARCHAR(200),                   -- nombre legible
  location    VARCHAR(200),                   -- ubicación física
  metadata    JSONB        DEFAULT '{}',      -- info adicional flexible
  is_active   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_serial   ON devices (serial_id);
CREATE INDEX IF NOT EXISTS idx_devices_domain   ON devices (domain_id);

-- ============================================================================
-- 4. Hypertables por dominio
--    Esquema unificado: serial_id + timestamp + JSONB
--    
--    ¿Por qué una tabla por dominio y no una sola?
--    - Cada dominio tiene variables muy diferentes en cantidad y tipo.
--    - Evita que dominios de alta frecuencia (eléctrico, ~133 vars) 
--      afecten las queries de dominios livianos (pozos, ~2 vars).
--    - Permite políticas de retención y compresión independientes.
--    - Agregar un dominio nuevo NO toca las tablas existentes.
--
--    Estructura del campo `data` (JSONB):
--    {
--      "REG4": 23.5,
--      "REG2000": 1,
--      "AI23": 45.2,
--      ...cualquier variable que mande el PLC
--    }
-- ============================================================================

-- ── Agua ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ts_agua (
  ts          TIMESTAMPTZ  NOT NULL,
  serial_id   VARCHAR(100) NOT NULL,
  data        JSONB        NOT NULL DEFAULT '{}'
);

SELECT create_hypertable('ts_agua', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_ts_agua_serial    ON ts_agua (serial_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ts_agua_data      ON ts_agua USING GIN (data);

-- ── Eléctrico ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ts_electrico (
  ts          TIMESTAMPTZ  NOT NULL,
  serial_id   VARCHAR(100) NOT NULL,
  data        JSONB        NOT NULL DEFAULT '{}'
);

SELECT create_hypertable('ts_electrico', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_ts_electrico_serial ON ts_electrico (serial_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ts_electrico_data   ON ts_electrico USING GIN (data);

-- ── Pozos ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ts_pozos (
  ts          TIMESTAMPTZ  NOT NULL,
  serial_id   VARCHAR(100) NOT NULL,
  data        JSONB        NOT NULL DEFAULT '{}'
);

SELECT create_hypertable('ts_pozos', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_ts_pozos_serial   ON ts_pozos (serial_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ts_pozos_data     ON ts_pozos USING GIN (data);

-- ============================================================================
-- 5. Tabla de métricas de uso de la API (se mantiene de la versión anterior)
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_metrics (
  id               SERIAL PRIMARY KEY,
  endpoint         VARCHAR(200) NOT NULL,
  domain_slug      VARCHAR(50),
  serial_id        VARCHAR(100),
  request_count    BIGINT       DEFAULT 0,
  bytes_sent       BIGINT       DEFAULT 0,
  updated_at       TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (endpoint, domain_slug, serial_id)
);

CREATE TABLE IF NOT EXISTS api_variable_metrics (
  id                SERIAL PRIMARY KEY,
  nombre_dato       VARCHAR(150) NOT NULL,
  serial_id         VARCHAR(100),
  request_count     BIGINT       DEFAULT 0,
  bytes_sent        BIGINT       DEFAULT 0,
  duration_ms_total BIGINT       DEFAULT 0,
  updated_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (nombre_dato, serial_id)
);

-- ============================================================================
-- 6. Función helper para crear hypertables de nuevos dominios
--    Uso: SELECT create_domain_hypertable('gas');
--    Esto crea la tabla ts_gas con la misma estructura.
-- ============================================================================
CREATE OR REPLACE FUNCTION create_domain_hypertable(domain_slug TEXT)
RETURNS VOID AS $$
DECLARE
  table_name TEXT := 'ts_' || domain_slug;
BEGIN
  -- Verificar que el dominio existe en el catálogo
  IF NOT EXISTS (SELECT 1 FROM domains WHERE slug = domain_slug) THEN
    RAISE EXCEPTION 'El dominio "%" no existe en la tabla domains', domain_slug;
  END IF;

  -- Verificar que la tabla no existe
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = table_name AND table_schema = 'public') THEN
    RAISE NOTICE 'La tabla % ya existe', table_name;
    RETURN;
  END IF;

  -- Crear tabla
  EXECUTE format(
    'CREATE TABLE %I (
       ts        TIMESTAMPTZ  NOT NULL,
       serial_id VARCHAR(100) NOT NULL,
       data      JSONB        NOT NULL DEFAULT ''{}''
     )', table_name
  );

  -- Convertir a hypertable
  PERFORM create_hypertable(table_name, 'ts', if_not_exists => TRUE);

  -- Crear índices
  EXECUTE format('CREATE INDEX idx_%I_serial ON %I (serial_id, ts DESC)', table_name, table_name);
  EXECUTE format('CREATE INDEX idx_%I_data   ON %I USING GIN (data)', table_name, table_name);

  RAISE NOTICE 'Hypertable % creada exitosamente', table_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Políticas de retención y compresión (ajustar según necesidad)
--    Por defecto: compresión después de 7 días, retención de 2 años.
-- ============================================================================

-- Compresión (reduce almacenamiento ~90%)
ALTER TABLE ts_agua       SET (timescaledb.compress);
ALTER TABLE ts_electrico  SET (timescaledb.compress);
ALTER TABLE ts_pozos      SET (timescaledb.compress);

SELECT add_compression_policy('ts_agua',       INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_compression_policy('ts_electrico',  INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_compression_policy('ts_pozos',      INTERVAL '7 days',  if_not_exists => TRUE);

-- Retención (borrado automático de datos viejos)
SELECT add_retention_policy('ts_agua',       INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('ts_electrico',  INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('ts_pozos',      INTERVAL '2 years', if_not_exists => TRUE);
