-- ============================================================================
-- 2026-05-17 — DGA Pozo-config Redesign
-- ============================================================================
-- Reorganiza el modelo DGA: la config de envío vive POR POZO
-- (pozo_config.dga_*) y las credenciales del informante viven en un POOL
-- GLOBAL (dga_informante) reusable entre pozos.
--
-- Antes:
--   - dga_user (site_id, rut_informante, clave_informante, transport,
--               caudal_max_lps, periodicidad, fecha_inicio, hora_inicio,
--               activo, ...)
--   - dato_dga.id_dgauser FK → dga_user(id_dgauser)
--   - dga_send_audit.id_dgauser
--
-- Después:
--   - dga_informante (rut PK, clave_informante, referencia)
--   - pozo_config (...existente..., dga_activo, dga_transport,
--                  dga_caudal_max_lps, dga_caudal_tolerance_pct,
--                  dga_periodicidad, dga_fecha_inicio, dga_hora_inicio,
--                  dga_informante_rut FK, dga_max_retry_attempts,
--                  dga_auto_accept_fallback_hours)
--   - dato_dga.site_id (PK compuesta con ts) — reemplaza id_dgauser
--   - dga_send_audit.site_id — idem
--   - DROP TABLE dga_user
--
-- Motivación:
--   1. Config DGA es propiedad del pozo, no de quien firma.
--   2. Un mismo informante (RUT) puede firmar varios pozos; cambiar su
--      clave una vez aplica a todos.
--   3. Toggle activo + transport visibles siempre desde el modal del pozo
--      (sin requerir crear informante primero).
--
-- Idempotente cuando es posible. NO idempotente en backfills si dga_user
-- ya fue droppeado (la primera corrida la borra).
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECCIÓN 1 — Pool global de informantes
-- ============================================================================
-- Una fila por RUT. La clave se cifra ANTES de insertar (ver crypto.ts).
-- referencia: etiqueta libre interna ("Juan operario turno A", "Empresa X",
-- etc.). No es nombre legal — DGA solo exige rutUsuario.

CREATE TABLE IF NOT EXISTS dga_informante (
  rut              VARCHAR(20)  PRIMARY KEY,
  clave_informante TEXT         NOT NULL,
  referencia       VARCHAR(150),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE dga_informante IS
  'Pool global de credenciales SNIA por RUT. Reusable entre pozos.';
COMMENT ON COLUMN dga_informante.clave_informante IS
  'Clave SNIA cifrada (AES-256-GCM). Ver dga/crypto.ts.';
COMMENT ON COLUMN dga_informante.referencia IS
  'Etiqueta libre para identificar al informante en UI. Opcional.';

-- ============================================================================
-- SECCIÓN 2 — pozo_config: columnas DGA por pozo
-- ============================================================================
-- Todo lo que define CÓMO y CUÁNDO se reporta un pozo a SNIA vive acá.
-- Los slots se generan según estas columnas, no según el informante.

ALTER TABLE pozo_config
  ADD COLUMN IF NOT EXISTS dga_activo                     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dga_transport                  VARCHAR(10) NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS dga_caudal_max_lps             NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS dga_caudal_tolerance_pct       NUMERIC(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS dga_periodicidad               VARCHAR(10),
  ADD COLUMN IF NOT EXISTS dga_fecha_inicio               DATE,
  ADD COLUMN IF NOT EXISTS dga_hora_inicio                TIME,
  ADD COLUMN IF NOT EXISTS dga_informante_rut             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS dga_max_retry_attempts         SMALLINT    NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS dga_auto_accept_fallback_hours SMALLINT,
  ADD COLUMN IF NOT EXISTS dga_last_run_at                TIMESTAMPTZ;

-- CHECK constraints. ADD IF NOT EXISTS no soportado para constraints, usamos
-- bloque condicional.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pozo_config_dga_transport_check') THEN
    ALTER TABLE pozo_config
      ADD CONSTRAINT pozo_config_dga_transport_check
      CHECK (dga_transport IN ('off','shadow','rest'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pozo_config_dga_periodicidad_check') THEN
    ALTER TABLE pozo_config
      ADD CONSTRAINT pozo_config_dga_periodicidad_check
      CHECK (dga_periodicidad IS NULL OR dga_periodicidad IN ('hora','dia','semana','mes'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pozo_config_dga_informante_fk') THEN
    ALTER TABLE pozo_config
      ADD CONSTRAINT pozo_config_dga_informante_fk
      FOREIGN KEY (dga_informante_rut) REFERENCES dga_informante(rut) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN pozo_config.dga_activo IS
  'Switch maestro de reporte DGA por pozo. Si FALSE: no se pre-seedea, '
  'no se rellena, no se envía. Independiente de sitio.activo.';
COMMENT ON COLUMN pozo_config.dga_transport IS
  'off | shadow | rest. off=pausado, shadow=rellena sin enviar, '
  'rest=envía a SNIA. Pasar a rest requiere 2FA en backend.';
COMMENT ON COLUMN pozo_config.dga_informante_rut IS
  'RUT del informante que firma envíos de este pozo. FK a dga_informante.';
COMMENT ON COLUMN pozo_config.dga_last_run_at IS
  'Marca de último ciclo de fill exitoso. Diagnóstico / monitoreo.';

-- ============================================================================
-- SECCIÓN 3 — Backfill desde dga_user (si existe)
-- ============================================================================
-- Si dga_user existe (primera corrida), migramos:
--   3.1. Credenciales → dga_informante (1 fila por RUT, última clave).
--   3.2. Config envío → pozo_config.dga_* (1 dga_user por sitio asumido).
--
-- Cuando hay múltiples dga_user por sitio (UNIQUE site_id+rut), tomamos
-- el más reciente (ORDER BY updated_at DESC) — solo 1 puede mapearse a
-- pozo_config porque el modelo nuevo es 1 informante por pozo.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dga_user') THEN
    -- 3.1 Backfill informantes
    INSERT INTO dga_informante (rut, clave_informante, referencia)
    SELECT DISTINCT ON (rut_informante)
      rut_informante,
      clave_informante,
      nombre_informante
    FROM dga_user
    ORDER BY rut_informante, updated_at DESC
    ON CONFLICT (rut) DO NOTHING;

    -- 3.2 Backfill pozo_config con datos del informante más reciente por sitio
    WITH latest_user AS (
      SELECT DISTINCT ON (site_id)
        site_id,
        rut_informante,
        activo,
        transport,
        caudal_max_lps,
        caudal_tolerance_pct,
        periodicidad,
        fecha_inicio,
        hora_inicio,
        max_retry_attempts,
        auto_accept_fallback_hours,
        last_run_at
      FROM dga_user
      ORDER BY site_id, updated_at DESC
    )
    UPDATE pozo_config pc
       SET dga_activo                     = lu.activo,
           dga_transport                  = lu.transport,
           dga_caudal_max_lps             = lu.caudal_max_lps,
           dga_caudal_tolerance_pct       = lu.caudal_tolerance_pct,
           dga_periodicidad               = lu.periodicidad,
           dga_fecha_inicio               = lu.fecha_inicio,
           dga_hora_inicio                = lu.hora_inicio,
           dga_informante_rut             = lu.rut_informante,
           dga_max_retry_attempts         = lu.max_retry_attempts,
           dga_auto_accept_fallback_hours = lu.auto_accept_fallback_hours,
           dga_last_run_at                = lu.last_run_at
      FROM latest_user lu
     WHERE pc.sitio_id = lu.site_id;
  END IF;
END $$;

-- ============================================================================
-- SECCIÓN 4 — Migrar dato_dga: id_dgauser → site_id
-- ============================================================================
-- dato_dga es hypertable Timescale. PK actual = (id_dgauser, ts).
-- PK nueva = (site_id, ts) — `site_id` permite muchas filas por pozo.
-- ts sigue siendo columna de partición Timescale.

ALTER TABLE dato_dga ADD COLUMN IF NOT EXISTS site_id VARCHAR(10);

-- Backfill desde dga_user (solo si existe; si ya se corrió, site_id ya está poblado)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dga_user') THEN
    UPDATE dato_dga d
       SET site_id = u.site_id
      FROM dga_user u
     WHERE d.id_dgauser = u.id_dgauser
       AND d.site_id IS NULL;
  END IF;
END $$;

-- Sólo cambiar PK y droppear id_dgauser cuando todas las filas tengan site_id
DO $$
DECLARE
  v_orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orphans FROM dato_dga WHERE site_id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'dato_dga tiene % filas sin site_id mapeable (id_dgauser huérfano). Abortando.', v_orphans;
  END IF;

  -- Drop old PK
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dato_dga_pkey') THEN
    ALTER TABLE dato_dga DROP CONSTRAINT dato_dga_pkey;
  END IF;

  -- NOT NULL + new PK
  ALTER TABLE dato_dga ALTER COLUMN site_id SET NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'dato_dga_pkey') THEN
    ALTER TABLE dato_dga ADD CONSTRAINT dato_dga_pkey PRIMARY KEY (site_id, ts);
  END IF;

  -- Drop col vieja (después de la PK nueva)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'dato_dga' AND column_name = 'id_dgauser') THEN
    ALTER TABLE dato_dga DROP COLUMN id_dgauser;
  END IF;
END $$;

-- FK a sitio (opcional pero defensiva — sitio.id es PK VARCHAR(10))
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dato_dga_site_id_fk') THEN
    ALTER TABLE dato_dga
      ADD CONSTRAINT dato_dga_site_id_fk
      FOREIGN KEY (site_id) REFERENCES sitio(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- SECCIÓN 5 — Migrar dga_send_audit: id_dgauser → site_id
-- ============================================================================

ALTER TABLE dga_send_audit ADD COLUMN IF NOT EXISTS site_id VARCHAR(10);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dga_user') THEN
    UPDATE dga_send_audit a
       SET site_id = u.site_id
      FROM dga_user u
     WHERE a.id_dgauser = u.id_dgauser
       AND a.site_id IS NULL;
  END IF;
END $$;

DO $$
DECLARE
  v_orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orphans FROM dga_send_audit WHERE site_id IS NULL;
  IF v_orphans > 0 THEN
    -- En audit, huérfanos son menos críticos: los marcamos con site_id vacío
    -- en vez de abortar, para no perder el log histórico.
    UPDATE dga_send_audit SET site_id = '__unknown__' WHERE site_id IS NULL;
  END IF;

  ALTER TABLE dga_send_audit ALTER COLUMN site_id SET NOT NULL;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'dga_send_audit' AND column_name = 'id_dgauser') THEN
    ALTER TABLE dga_send_audit DROP COLUMN id_dgauser;
  END IF;
END $$;

-- ============================================================================
-- SECCIÓN 6 — Re-crear índices con site_id
-- ============================================================================

DROP INDEX IF EXISTS idx_audit_slot;
CREATE INDEX IF NOT EXISTS idx_audit_slot
  ON dga_send_audit (site_id, ts);

DROP INDEX IF EXISTS idx_dato_dga_pending_retry;
CREATE INDEX IF NOT EXISTS idx_dato_dga_pending_retry
  ON dato_dga (next_retry_at NULLS FIRST, site_id)
  WHERE estatus = 'pendiente';

DROP INDEX IF EXISTS idx_dato_dga_review_queue;
CREATE INDEX IF NOT EXISTS idx_dato_dga_review_queue
  ON dato_dga (site_id, ts DESC)
  WHERE estatus = 'requires_review';

-- ============================================================================
-- SECCIÓN 7 — DROP tabla dga_user
-- ============================================================================
-- Confirmado: pool de informantes vive ahora en dga_informante, config DGA
-- en pozo_config.dga_*. dga_user queda obsoleta.

DROP TABLE IF EXISTS dga_user CASCADE;

-- ============================================================================
-- SECCIÓN 8 — Verificación
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dga_informante') THEN
    RAISE EXCEPTION 'dga_informante no se creó';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dga_user') THEN
    RAISE EXCEPTION 'dga_user no fue droppeada';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'dato_dga' AND column_name = 'id_dgauser') THEN
    RAISE EXCEPTION 'dato_dga.id_dgauser no fue droppeada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'pozo_config' AND column_name = 'dga_activo') THEN
    RAISE EXCEPTION 'pozo_config.dga_activo no se agregó';
  END IF;
  RAISE NOTICE 'DGA pozo-config redesign: OK';
END $$;

COMMIT;

-- ============================================================================
-- FIN — Próximos pasos en código aplicación (NO en esta migración):
--   1. Workers (preseed/fill/submission/reconciler) → leer pozo_config.dga_*
--      en vez de dga_user, usar site_id como PK lógica.
--   2. Repos: actualizar todas las queries de dato_dga y dga_send_audit
--      para usar site_id.
--   3. Endpoints REST nuevos:
--        POST   /api/v2/dga/informantes
--        GET    /api/v2/dga/informantes
--        PATCH  /api/v2/dga/informantes/:rut (rotación clave + 2FA)
--        DELETE /api/v2/dga/informantes/:rut
--        PATCH  /api/companies/sites/:siteId/pozo-config (con 2FA cuando
--               dga_transport='rest')
--   4. Frontend: refactor modal con:
--        - Sección Activación (toggle/transport/caudal/periodicidad/fecha/hora) siempre visible
--        - Sección Informante (dropdown global + form rut/clave/referencia opcional)
--        - Sección Datos en vivo (lectura actual del pozo formateada SNIA)
--        - 2FA inline al activar transport=rest
--   5. Drop /api/v2/dga/users/* endpoints obsoletos (dga_user no existe).
-- ============================================================================
