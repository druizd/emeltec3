-- ===========================================
-- db_infra | Schema de inicialización
-- TimescaleDB (PostgreSQL 16)
-- ===========================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- -------------------------------------------
-- Tablas relacionales
-- -------------------------------------------

CREATE TABLE IF NOT EXISTS empresa (
    id           VARCHAR(10)   PRIMARY KEY,
    nombre       VARCHAR(150)  NOT NULL,
    rut          VARCHAR(20)   NOT NULL UNIQUE,
    sitios       INTEGER       DEFAULT 0,
    tipo_empresa VARCHAR(50)   NOT NULL,
    created_at   TIMESTAMPTZ   DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_empresa (
    id          VARCHAR(10)   PRIMARY KEY,
    nombre      VARCHAR(150)  NOT NULL,
    rut         VARCHAR(20)   NOT NULL UNIQUE,
    sitios      INTEGER       DEFAULT 0,
    empresa_id  VARCHAR(10)   NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ   DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuario (
    id             VARCHAR(10)   PRIMARY KEY,
    nombre         VARCHAR(100)  NOT NULL,
    apellido       VARCHAR(100)  NOT NULL,
    email          VARCHAR(150)  NOT NULL UNIQUE,
    telefono       VARCHAR(20),
    cargo          VARCHAR(80),
    tipo           VARCHAR(30)   NOT NULL,
    empresa_id     VARCHAR(10)   REFERENCES empresa(id) ON DELETE SET NULL,
    sub_empresa_id VARCHAR(10)   REFERENCES sub_empresa(id) ON DELETE SET NULL,
    password_hash  VARCHAR(255),
    otp_hash       VARCHAR(255),
    otp_expires_at TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sitio (
    id          VARCHAR(10)   PRIMARY KEY,
    descripcion VARCHAR(255)  NOT NULL,
    id_serial   VARCHAR(50)   NOT NULL,
    empresa_id  VARCHAR(10)   NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    sub_empresa_id VARCHAR(10) NOT NULL REFERENCES sub_empresa(id) ON DELETE CASCADE,
    ubicacion   VARCHAR(255),
    tipo_sitio  VARCHAR(30)   NOT NULL DEFAULT 'pozo',
    activo      BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ   DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pozo_config (
    sitio_id                VARCHAR(10) PRIMARY KEY REFERENCES sitio(id) ON DELETE CASCADE,
    profundidad_pozo_m      NUMERIC,
    profundidad_sensor_m    NUMERIC,
    nivel_estatico_manual_m NUMERIC,
    obra_dga                VARCHAR(80),
    slug                    VARCHAR(120),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reg_map (
    id         VARCHAR(20)   PRIMARY KEY,
    alias      VARCHAR(100)  NOT NULL,
    d1         VARCHAR(20)   NOT NULL,
    d2         VARCHAR(20),
    tipo_dato  VARCHAR(20)   NOT NULL,
    unidad     VARCHAR(20),
    rol_dashboard VARCHAR(40) DEFAULT 'generico',
    transformacion VARCHAR(40) DEFAULT 'directo',
    parametros JSONB DEFAULT '{}'::jsonb,
    sitio_id   VARCHAR(10)   REFERENCES sitio(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ   DEFAULT NOW(),
    updated_at TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alertas (
    id               SERIAL        PRIMARY KEY,
    nombre           VARCHAR(150)  NOT NULL,
    descripcion      TEXT,
    sitio_id         VARCHAR(10)   NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
    empresa_id       VARCHAR(10)   NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    sub_empresa_id   VARCHAR(10)   REFERENCES sub_empresa(id) ON DELETE SET NULL,
    variable_key     VARCHAR(50)   NOT NULL,
    condicion        VARCHAR(20)   NOT NULL
                     CHECK (condicion IN ('mayor_que','menor_que','igual_a','fuera_rango','sin_datos','dga_atrasado')),
    umbral_bajo      NUMERIC,
    umbral_alto      NUMERIC,
    severidad        VARCHAR(20)   NOT NULL DEFAULT 'media'
                     CHECK (severidad IN ('baja','media','alta','critica')),
    activa           BOOLEAN       NOT NULL DEFAULT TRUE,
    cooldown_minutos INTEGER       NOT NULL DEFAULT 5,
    dias_activos     TEXT[]        NOT NULL DEFAULT ARRAY['lunes','martes','miercoles','jueves','viernes','sabado','domingo'],
    creado_por       VARCHAR(10)   REFERENCES usuario(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ   DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alertas_eventos (
    id               SERIAL        PRIMARY KEY,
    alerta_id        INTEGER       NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
    empresa_id       VARCHAR(10)   NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
    sub_empresa_id   VARCHAR(10)   REFERENCES sub_empresa(id) ON DELETE SET NULL,
    sitio_id         VARCHAR(10)   NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
    variable_key     VARCHAR(50)   NOT NULL,
    valor_detectado  NUMERIC,
    valor_texto      TEXT,
    mensaje          TEXT          NOT NULL,
    severidad        VARCHAR(20)   NOT NULL
                     CHECK (severidad IN ('baja','media','alta','critica')),
    notificado       BOOLEAN       NOT NULL DEFAULT FALSE,
    resuelta         BOOLEAN       NOT NULL DEFAULT FALSE,
    reconocida_at    TIMESTAMPTZ,
    reconocida_por   VARCHAR(10)   REFERENCES usuario(id) ON DELETE SET NULL,
    asignado_a       VARCHAR(10)   REFERENCES usuario(id) ON DELETE SET NULL,
    asignado_at      TIMESTAMPTZ,
    incidencia_id    VARCHAR(50),
    triggered_at     TIMESTAMPTZ   DEFAULT NOW(),
    resuelta_at      TIMESTAMPTZ
);

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

-- -------------------------------------------
-- Hypertable — series temporales
-- Chunks: 1 día | ~80 equipos, hasta 1 dato/s
-- -------------------------------------------

CREATE TABLE IF NOT EXISTS equipo (
    time        TIMESTAMPTZ  NOT NULL,
    id_serial   VARCHAR(50)  NOT NULL,
    data        JSONB        NOT NULL,
    received_at TIMESTAMPTZ  DEFAULT NOW()
);

SELECT create_hypertable(
    'equipo', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists       => TRUE
);

-- -------------------------------------------
-- Índices
-- -------------------------------------------

CREATE INDEX IF NOT EXISTS idx_equipo_serial_time ON equipo (id_serial, time DESC);
CREATE INDEX IF NOT EXISTS idx_equipo_data_gin    ON equipo USING GIN (data);
CREATE INDEX IF NOT EXISTS idx_sitio_empresa      ON sitio (empresa_id);
CREATE INDEX IF NOT EXISTS idx_sitio_sub_empresa  ON sitio (sub_empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuario_empresa    ON usuario (empresa_id);
CREATE INDEX IF NOT EXISTS idx_regmap_sitio       ON reg_map (sitio_id);
CREATE INDEX IF NOT EXISTS idx_pozo_config_sitio  ON pozo_config (sitio_id);
CREATE INDEX IF NOT EXISTS idx_alertas_empresa    ON alertas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_alertas_sitio      ON alertas (sitio_id);
CREATE INDEX IF NOT EXISTS idx_alertas_eventos_emp  ON alertas_eventos (empresa_id, resuelta, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_eventos_alerta ON alertas_eventos (alerta_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_eventos_asignado ON alertas_eventos (asignado_a) WHERE asignado_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidencias_sitio   ON incidencias (sitio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_empresa ON incidencias (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_estado  ON incidencias (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidencias_alerta_evt ON incidencias (alerta_evento_id) WHERE alerta_evento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documentos_sitio   ON documentos (sitio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_empresa ON documentos (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_tipo    ON documentos (tipo, created_at DESC);

-- -------------------------------------------
-- Compresión automática (después de 7 días)
-- -------------------------------------------

ALTER TABLE equipo SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'id_serial',
    timescaledb.compress_orderby   = 'time DESC'
);

SELECT add_compression_policy('equipo',
    compress_after => INTERVAL '7 days',
    if_not_exists  => TRUE
);

-- -------------------------------------------
-- Continuous Aggregates (día, semana, mes, año)
-- -------------------------------------------

-- Por día (refresca cada 1h)
CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', time) AS bucket, id_serial, COUNT(*) AS total_registros
FROM equipo GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_daily',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

-- Por semana (refresca cada 3h)
CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_weekly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 week', time) AS bucket, id_serial, COUNT(*) AS total_registros
FROM equipo GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_weekly',
    start_offset => INTERVAL '3 weeks', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '3 hours', if_not_exists => TRUE);

-- Por mes (refresca cada 12h)
CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_monthly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 month', time) AS bucket, id_serial, COUNT(*) AS total_registros
FROM equipo GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_monthly',
    start_offset => INTERVAL '3 months', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '12 hours', if_not_exists => TRUE);

-- Por año (refresca cada 1d)
CREATE MATERIALIZED VIEW IF NOT EXISTS equipo_yearly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 year', time) AS bucket, id_serial, COUNT(*) AS total_registros
FROM equipo GROUP BY bucket, id_serial
WITH NO DATA;

SELECT add_continuous_aggregate_policy('equipo_yearly',
    start_offset => INTERVAL '26 months', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 day', if_not_exists => TRUE);

-- -------------------------------------------
-- Datos de prueba
-- -------------------------------------------

INSERT INTO empresa (id, nombre, rut, sitios, tipo_empresa)
VALUES ('E100', 'Empresa Demo SpA', '76.123.456-7', 2, 'Industrial')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sub_empresa (id, nombre, rut, sitios, empresa_id)
VALUES ('SE101', 'Division Norte', '76.123.456-1', 1, 'E100')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sitio (id, descripcion, id_serial, empresa_id, sub_empresa_id, ubicacion)
VALUES ('S100', 'Planta Principal - Sensor Temperatura', '151.65.22.2', 'E100', 'SE101', 'Santiago, Chile')
ON CONFLICT (id) DO NOTHING;

INSERT INTO reg_map (id, alias, d1, d2, tipo_dato, unidad, sitio_id)
VALUES ('151.65.22.2', 'Temperatura Ambiente', 'REG1', NULL, 'FLOAT', 'T°', 'S100')
ON CONFLICT (id) DO NOTHING;

INSERT INTO equipo (time, id_serial, data) VALUES
    (NOW() - INTERVAL '2 hours', '151.65.22.2', '{"REG1": 1500, "REG4": 23.5, "IR1": "OK"}'::jsonb),
    (NOW() - INTERVAL '1 hour',  '151.65.22.2', '{"REG1": 1520, "REG4": 24.1, "IR1": "OK"}'::jsonb),
    (NOW(),                       '151.65.22.2', '{"REG1": 1480, "REG4": 22.8, "IR1": "WARN"}'::jsonb);

-- Verificación
SELECT hypertable_name, num_dimensions FROM timescaledb_information.hypertables
WHERE hypertable_name = 'equipo';
