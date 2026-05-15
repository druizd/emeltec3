-- 2026-05-14 — Tablas de observabilidad interna de la API (uso por endpoint y por variable).
-- Anteriormente creadas en runtime por `ensureTables()` en main-api (flusher.ts + metricsService.js).
-- Se mueven a migration versionada para evitar:
--   * Schema escondido en código fuera de infra-db/.
--   * Requerir privilegio CREATE al rol de aplicación en prod.
--   * Drift entre instancias que arrancan en paralelo.

BEGIN;

-- ── api_metrics: uso agregado por (endpoint, domain_slug, serial_id) ──────────
CREATE TABLE IF NOT EXISTS public.api_metrics (
    id              SERIAL        PRIMARY KEY,
    endpoint        VARCHAR(200)  NOT NULL,
    domain_slug     VARCHAR(50),
    serial_id       VARCHAR(100),
    request_count   BIGINT        DEFAULT 0,
    bytes_sent      BIGINT        DEFAULT 0,
    updated_at      TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE (endpoint, domain_slug, serial_id)
);

CREATE INDEX IF NOT EXISTS idx_api_metrics_lookup
    ON public.api_metrics (endpoint, domain_slug, serial_id);

COMMENT ON TABLE public.api_metrics IS 'Métricas de uso de API agregadas por endpoint. Escritas por el flusher (main-api).';

-- ── api_variable_metrics: uso agregado por (nombre_dato, serial_id) ──────────
CREATE TABLE IF NOT EXISTS public.api_variable_metrics (
    id                 SERIAL        PRIMARY KEY,
    nombre_dato        VARCHAR(150)  NOT NULL,
    serial_id          VARCHAR(100),
    request_count      BIGINT        DEFAULT 0,
    bytes_sent         BIGINT        DEFAULT 0,
    duration_ms_total  BIGINT        DEFAULT 0,
    updated_at         TIMESTAMPTZ   DEFAULT NOW(),
    UNIQUE (nombre_dato, serial_id)
);

CREATE INDEX IF NOT EXISTS idx_api_variable_metrics_lookup
    ON public.api_variable_metrics (nombre_dato, serial_id);

COMMENT ON TABLE public.api_variable_metrics IS 'Métricas de uso de API agregadas por variable de telemetría. Escritas por el flusher (main-api).';

COMMIT;
