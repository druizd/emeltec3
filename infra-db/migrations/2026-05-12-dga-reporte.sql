-- =====================================================
-- DGA Reporte: informantes + mediciones para reporte DGA-MOP
-- - dga_user: tabla normal con credenciales del informante por sitio
-- - dato_dga: hypertable con mediciones reportadas (ts UTC raw)
--   fecha/hora se derivan a UTC-4 (Chile continental, sin DST)
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Tabla informante (normal) ----------
-- nombre_informante: persona registrada como responsable del reporte ante DGA.
-- fecha_inicio + hora_inicio: cuándo arranca el envío automático.
-- last_run_at: último snapshot procesado por el worker (idempotencia).
CREATE TABLE IF NOT EXISTS dga_user (
  id_dgauser        BIGSERIAL    PRIMARY KEY,
  site_id           VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
  nombre_informante VARCHAR(150) NOT NULL,
  rut_informante    VARCHAR(20)  NOT NULL,
  clave_informante  TEXT         NOT NULL,
  periodicidad      VARCHAR(10)  NOT NULL
                    CHECK (periodicidad IN ('hora','dia','semana','mes')),
  fecha_inicio      DATE         NOT NULL,
  hora_inicio       TIME         NOT NULL,
  last_run_at       TIMESTAMPTZ,
  activo            BOOLEAN      DEFAULT TRUE,
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (site_id, rut_informante)
);

CREATE INDEX IF NOT EXISTS idx_dga_user_site   ON dga_user (site_id);
CREATE INDEX IF NOT EXISTS idx_dga_user_activo ON dga_user (activo) WHERE activo = TRUE;

-- ---------- Tabla mediciones (hypertable) ----------
CREATE TABLE IF NOT EXISTS dato_dga (
  id_dgauser          BIGINT       NOT NULL REFERENCES dga_user(id_dgauser) ON DELETE CASCADE,
  obra                VARCHAR(150) NOT NULL,
  ts                  TIMESTAMPTZ  NOT NULL,
  fecha               DATE         GENERATED ALWAYS AS ((ts AT TIME ZONE 'Etc/GMT+4')::date) STORED,
  hora                TIME         GENERATED ALWAYS AS ((ts AT TIME ZONE 'Etc/GMT+4')::time) STORED,
  caudal_instantaneo  NUMERIC(12,3),
  flujo_acumulado     NUMERIC(14,3),
  nivel_freatico      NUMERIC(8,3),
  PRIMARY KEY (id_dgauser, ts)
);

SELECT create_hypertable('dato_dga', 'ts',
  chunk_time_interval => INTERVAL '1 month',
  if_not_exists       => TRUE
);

CREATE INDEX IF NOT EXISTS idx_dato_dga_fecha   ON dato_dga (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_dato_dga_obra_ts ON dato_dga (obra, ts DESC);

-- Verificación
SELECT hypertable_name FROM timescaledb_information.hypertables
WHERE hypertable_name = 'dato_dga';
