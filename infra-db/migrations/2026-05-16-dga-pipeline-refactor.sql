-- ============================================================================
-- 2026-05-16 — DGA Pipeline Refactor
-- ============================================================================
-- Alinea el pipeline DGA al Manual Técnico DGA 1/2025
-- (Resolución Exenta N° 2.170, Diario Oficial 04-jul-2025).
--
-- Refactor ADITIVO sobre tablas existentes:
--   - dga_user            → agrega: transport, caudal_max_lps, retry policy
--   - dato_dga            → agrega: estados refinados, retry, validación
--   - dga_send_audit (NUEVA) → audit trail append-only por cada intento de envío
--   - reg_map.parametros  → convención JSON para offsets / scale_factor
--
-- Filosofía:
--   * Pre-seed slots del mes con estatus='vacio' (modelo legacy fidedigno).
--   * Validar datos ANTES de enviar (no enviar basura → §6.3 evita bloqueo).
--   * Kill switch granular (transport por sitio + activo + flag global env).
--   * Retry 1/día por slot (Res 2170 §6.2). Máx 7 intentos → 'fallido'.
--   * Audit append-only para reconciliación y diagnóstico.
--
-- Idempotente: safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECCIÓN 1 — dga_user (config DGA por sitio/informante)
-- ============================================================================
-- dga_user representa la configuración de envío DGA de un sitio: credenciales
-- del informante, periodicidad, fecha de inicio. Esta sección agrega control
-- de envío granular y validación de norma DGA por obra.

-- transport: kill switch de envío por sitio (independiente de activo).
--   'off'    → no envía, no rellena (sitio pausado completo).
--   'shadow' → rellena slots, NO envía. Para comparar contra legacy histórico
--              antes de migrar. Datos quedan en 'pendiente' indefinidamente.
--   'rest'   → envía a SNIA via endpoint REST oficial (Res 2170).
--
-- WHY: permite migración 1-obra-a-1-obra sin doble envío (riesgo §6.3 bloqueo
--      del Centro de Control). Si algo falla → flipear a 'off' sin redeploy.
ALTER TABLE dga_user
  ADD COLUMN IF NOT EXISTS transport VARCHAR(10) NOT NULL DEFAULT 'off'
                           CHECK (transport IN ('off','shadow','rest'));
COMMENT ON COLUMN dga_user.transport IS
  'Modo de envío DGA: off=pausado, shadow=rellena sin enviar (validación), '
  'rest=envía a SNIA (Res 2170). Cambiar a rest solo después de validar '
  'shadow contra legacy histórico.';

-- caudal_max_lps: caudal máximo legal según derecho de aprovechamiento de
-- aguas de la obra (Catastro Público de Aguas DGA). Validación pre-envío
-- compara la medición contra este límite × tolerancia.
--
-- WHY: el legacy hardcodea |flow| > 1000 → forzar 0. Es heurística pobre.
--      El derecho legal varía por obra (pozo pequeño minero = 1 L/s; gran
--      planta = 200+ L/s). Validar contra el derecho real evita falsos
--      positivos en obras grandes y captura abuso real en obras pequeñas.
-- FUENTE: scraping CPA https://snia.mop.gob.cl/dgacatastro/ por codigoObra.
ALTER TABLE dga_user
  ADD COLUMN IF NOT EXISTS caudal_max_lps NUMERIC(10,2);
COMMENT ON COLUMN dga_user.caudal_max_lps IS
  'Caudal máximo legal L/s según derecho de aprovechamiento. NULL = no '
  'cargado (fallback a heurística histórica P99 ×1.3 o hardcode 1000). '
  'Poblar via scraping CPA por codigoObra.';

-- caudal_tolerance_pct: % sobre caudal_max_lps antes de marcar requires_review.
-- Default 20% = cubre picos transitorios legítimos sin perder violaciones reales.
ALTER TABLE dga_user
  ADD COLUMN IF NOT EXISTS caudal_tolerance_pct NUMERIC(5,2) NOT NULL DEFAULT 20;
COMMENT ON COLUMN dga_user.caudal_tolerance_pct IS
  'Tolerancia porcentual sobre caudal_max_lps antes de marcar slot como '
  'requires_review. Default 20%. Si |flow| > caudal_max_lps × (1 + pct/100) '
  '→ requires_review con motivo flow_exceeds_water_right.';

-- max_retry_attempts: número de días consecutivos que se reintentará un envío
-- rechazado antes de marcar 'fallido'. Res 2170 §6.2: reenviar 1 vez/día.
-- Default 7 = una semana de reintentos antes de requerir intervención manual.
ALTER TABLE dga_user
  ADD COLUMN IF NOT EXISTS max_retry_attempts SMALLINT NOT NULL DEFAULT 7;
COMMENT ON COLUMN dga_user.max_retry_attempts IS
  'Días consecutivos de reintento antes de marcar slot como fallido. '
  'Default 7. Política Res 2170 §6.2: 1 reenvío/día tras rechazo.';

-- auto_accept_fallback_hours: si > 0, tras N horas sin acción admin sobre
-- un slot en requires_review, el sistema acepta automáticamente el valor
-- fallback sugerido (ej. último totalizador válido). NULL = siempre manual.
--
-- WHY: usuario eligió NULL como default. Slots dudosos esperan decisión
--      humana indefinidamente. Activar por obra solo si se confía.
ALTER TABLE dga_user
  ADD COLUMN IF NOT EXISTS auto_accept_fallback_hours SMALLINT;
COMMENT ON COLUMN dga_user.auto_accept_fallback_hours IS
  'Horas antes de aceptar automáticamente el fallback sugerido en un slot '
  'requires_review. NULL = siempre requiere admin (default seguro). '
  'Activar por obra solo cuando se haya validado el comportamiento del '
  'sensor en producción.';

-- ============================================================================
-- SECCIÓN 2 — dato_dga (mediciones + estado de envío)
-- ============================================================================
-- dato_dga es la cola de slots DGA. Cada fila = una medición a enviar (o ya
-- enviada). PK compuesta (id_dgauser, ts) garantiza unicidad slot/informante.
--
-- Modelo: pre-seed mes con estatus='vacio' → fill desde telemetría →
--         'pendiente' → submission → 'enviado'|'rechazado'|'fallido'.

-- ----------------------------------------------------------------------------
-- 2.1 — Refactor del enum estatus (más estados granulares)
-- ----------------------------------------------------------------------------
-- Estado anterior: 'pendiente' | 'enviado' | 'rechazado' (3 valores).
-- Estado nuevo: 7 valores. Cada uno modela una fase distinta del pipeline:
--   'vacio'           → slot pre-seedeado, sin datos aún (telemetría no
--                       llegó o no se ha rellenado).
--   'pendiente'       → relleno OK, validación pasada, listo para enviar.
--   'requires_review' → relleno con datos sospechosos (totalizador=0, flow
--                       absurdo, sensor defectuoso). NO se envía hasta que
--                       admin decida en UI (acepta fallback, edita, descarta).
--   'enviando'        → lock pesimista durante el HTTP call a SNIA. Evita
--                       doble envío si proceso muere entre fetch y update.
--   'enviado'         → SNIA respondió status='00'. Terminal happy path.
--   'rechazado'       → SNIA respondió ≠'00' o falla red. Se reintenta
--                       según retry policy (next_retry_at).
--   'fallido'         → max_retry_attempts agotados. Terminal sad path.
--                       Requiere intervención manual.

ALTER TABLE dato_dga DROP CONSTRAINT IF EXISTS dato_dga_estatus_check;
ALTER TABLE dato_dga
  ALTER COLUMN estatus SET DEFAULT 'vacio';
ALTER TABLE dato_dga
  ADD CONSTRAINT dato_dga_estatus_check
  CHECK (estatus IN ('vacio','pendiente','requires_review','enviando','enviado','rechazado','fallido'));
COMMENT ON COLUMN dato_dga.estatus IS
  'Estado del slot en el pipeline DGA. Flujo típico: '
  'vacio → pendiente → enviando → enviado. '
  'Bifurcaciones: pendiente → requires_review (validación falla), '
  'enviando → rechazado → pendiente (retry) → ... → fallido.';

-- ----------------------------------------------------------------------------
-- 2.2 — validation_warnings: razones por las que el slot está en requires_review
-- ----------------------------------------------------------------------------
-- JSONB array con objetos describiendo cada anomalía detectada en el slot.
-- Ejemplos:
--   [{ "code": "totalizator_zero", "raw": 0, "suggested": 12345,
--      "reason": "lectura totalizador=0, posible sensor desconectado" }]
--   [{ "code": "flow_exceeds_water_right", "raw": 250.5, "limit": 200,
--      "tolerance_pct": 20 }]
--   [{ "code": "insufficient_records", "count": 22, "required": 40 }]
--   [{ "code": "sensor_known_defective", "site_marker": "site_73" }]
--
-- WHY: jsonb permite múltiples warnings por slot (un slot puede tener
--      totalizador en 0 Y caudal absurdo simultáneamente). Estructura
--      consultable desde UI para que admin vea el detalle.
ALTER TABLE dato_dga
  ADD COLUMN IF NOT EXISTS validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN dato_dga.validation_warnings IS
  'Array JSON de anomalías detectadas en validación. Se llena cuando el '
  'slot pasa a requires_review. Cada elemento: {code, raw, suggested?, '
  'reason}. Vacío [] cuando no hay anomalías.';

-- ----------------------------------------------------------------------------
-- 2.3 — Retry policy fields
-- ----------------------------------------------------------------------------
-- next_retry_at: cuándo el submission worker debe re-evaluar este slot.
-- Se setea tras cada rechazo: next_retry_at = last_attempt + 24h (Res 2170 §6.2).
-- Worker filtra: WHERE estatus='pendiente' AND next_retry_at <= now().
ALTER TABLE dato_dga
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
COMMENT ON COLUMN dato_dga.next_retry_at IS
  'Timestamp del próximo intento de envío. NULL = envío inmediato en el '
  'siguiente tick. Setear a now()+24h tras rechazo (Res 2170 §6.2: '
  '1 reintento/día). Submission worker usa este campo para filtrar cola.';

-- fail_reason: descripción del último motivo de rechazo/fallo.
-- Útil para diagnóstico rápido sin consultar audit completo.
ALTER TABLE dato_dga
  ADD COLUMN IF NOT EXISTS fail_reason TEXT;
COMMENT ON COLUMN dato_dga.fail_reason IS
  'Última razón de fallo (mensaje SNIA o error red/timeout). Se actualiza '
  'en cada intento fallido. NULL en slots nunca enviados o enviados OK.';

-- ----------------------------------------------------------------------------
-- 2.4 — totalizator_raw_legacy: preserva decimal histórico
-- ----------------------------------------------------------------------------
-- CSV histórico contiene totalizador con decimales (ej. 548669.188).
-- Manual Técnico DGA 1/2025 §4 exige entero sin decimales para envío.
-- Decisión: guardar entero truncado en flujo_acumulado (consistencia web/DGA),
--           pero preservar el decimal original en columna separada para
--           auditoría histórica y análisis retrospectivos.
--
-- WHY: si en el futuro se descubre que el decimal era significativo (ej.
--      precisión de sensor mejorada), no perdemos el dato original. Solo
--      ocupa espacio en datos importados de legacy; slots nuevos generados
--      por el pipeline guardan NULL aquí (no aplica).
ALTER TABLE dato_dga
  ADD COLUMN IF NOT EXISTS totalizator_raw_legacy NUMERIC(14,3);
COMMENT ON COLUMN dato_dga.totalizator_raw_legacy IS
  'Totalizador original con decimales del CSV histórico legacy. '
  'flujo_acumulado almacena el truncado entero (consistencia web/DGA). '
  'NULL en slots nuevos generados por el pipeline (no aplica).';

-- ----------------------------------------------------------------------------
-- 2.5 — Índices para queries de pipeline
-- ----------------------------------------------------------------------------

-- Cola de envío + cola de revisión.
-- IMPORTANTE: los indices originales usaban id_dgauser, pero la migración
-- 2026-05-17 dropea esa columna y recrea los indices con site_id. Si la
-- columna ya no existe (re-aplicación post-2026-05-17), skip — la otra
-- migración los maneja.
DROP INDEX IF EXISTS idx_dato_dga_submission;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='dato_dga' AND column_name='id_dgauser') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dato_dga_pending_retry
               ON dato_dga (next_retry_at NULLS FIRST, id_dgauser)
               WHERE estatus = ''pendiente''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dato_dga_review_queue
               ON dato_dga (id_dgauser, ts DESC)
               WHERE estatus = ''requires_review''';
  END IF;
END $$;

-- ============================================================================
-- SECCIÓN 3 — dga_send_audit (NUEVA, append-only)
-- ============================================================================
-- Registro append-only de TODOS los intentos de envío a SNIA. Cada intento
-- = una fila. Nunca se actualiza, nunca se borra (excepto archival masivo).
--
-- Propósitos:
--   1. Reconciliación: cada 1h, reconciler compara audit vs dato_dga.estatus
--      y corrige drift (ej. proceso murió entre POST y UPDATE).
--   2. Diagnóstico: si SNIA rechaza, audit contiene request_payload exacto y
--      raw_response para reproducir el problema.
--   3. Cumplimiento: traza completa de qué se envió, cuándo y con qué
--      resultado. Necesario ante fiscalización DGA.
--   4. Daily summary: cuenta intentos/enviados/rechazados por día/obra.

CREATE TABLE IF NOT EXISTS dga_send_audit (
  id                      BIGSERIAL    PRIMARY KEY,

  -- FK compuesta lógica a dato_dga (PK = id_dgauser + ts).
  -- No usamos FK física para permitir auditar slots que pudieron ser
  -- eliminados (improbable, pero defensivo). Integridad la garantiza la app.
  id_dgauser              BIGINT       NOT NULL,
  ts                      TIMESTAMPTZ  NOT NULL,

  -- attempt_n: número de intento (1, 2, 3...). Útil para correlacionar
  -- con dato_dga.intentos. Reset implícito al volver a 'pendiente' (no
  -- borramos audit, solo el contador en dato_dga avanza).
  attempt_n               SMALLINT     NOT NULL,

  -- transport usado en este intento. Permite distinguir envíos reales
  -- de imports del CSV legacy.
  --   'rest'           → envío real a SNIA REST.
  --   'soap'           → si en el futuro se mantiene cliente SOAP (no plan actual).
  --   'legacy-import'  → fila creada por el importador del CSV histórico
  --                      (no fue un POST real desde este sistema).
  transport               VARCHAR(20)  NOT NULL
                           CHECK (transport IN ('rest','soap','legacy-import')),

  -- Status HTTP de la respuesta (200, 400, 500, etc.). NULL si falla red
  -- antes de recibir respuesta (timeout, DNS, conexión rechazada).
  http_status             INTEGER,

  -- Código de aplicación devuelto por SNIA dentro del body JSON.
  -- '00' = OK. Cualquier otro = error de validación o negocio.
  -- Ver Res 2170 §5.1.
  dga_status_code         VARCHAR(10),
  dga_message             TEXT,

  -- Comprobante devuelto por SNIA cuando status='00'. Identifica
  -- unívocamente la medición en el sistema MIA-DGA. Necesario para
  -- consultar estado via GET /mediciones/subterraneas?codigoObra=X&numeroComprobante=Y
  api_n_comprobante       TEXT,
  api_status_description  TEXT,

  -- Payload exacto enviado (sin password — se ofusca antes de guardar).
  -- Crítico para diagnóstico cuando SNIA rechaza por formato.
  request_payload         JSONB,

  -- Respuesta completa SNIA. Permite revisar campos no parseados.
  raw_response            JSONB,

  -- Momento del envío y latencia. Para SLA "≤1h post-medición" (Res 2170 §3).
  sent_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  duration_ms             INTEGER,

  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dga_send_audit IS
  'Registro append-only de intentos de envío a SNIA. Una fila por POST. '
  'Nunca UPDATE ni DELETE en operación normal. Fuente de verdad para '
  'reconciliación y cumplimiento DGA.';

COMMENT ON COLUMN dga_send_audit.attempt_n IS
  'Número de intento (1, 2, 3...). Correlaciona con dato_dga.intentos. '
  'Cuando dato_dga vuelve a pendiente tras rechazo, próximo intento '
  'incrementa este valor.';

COMMENT ON COLUMN dga_send_audit.transport IS
  'rest=envío real REST SNIA. soap=cliente SOAP (no plan actual). '
  'legacy-import=fila sintética del importador CSV histórico (no fue '
  'un POST real desde este sistema, refleja envío hecho por legacy).';

COMMENT ON COLUMN dga_send_audit.request_payload IS
  'Body JSON enviado al endpoint SNIA. PASSWORD OFUSCADO (****) antes '
  'de persistir. Headers (codigoObra, timeStampOrigen) incluidos en '
  'una clave _headers para diagnóstico.';

-- Índices del audit
-- IMPORTANTE: idx_audit_slot original usaba id_dgauser; 2026-05-17 lo
-- recrea con site_id. Skip si la columna ya no existe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='dga_send_audit' AND column_name='id_dgauser') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_slot
               ON dga_send_audit (id_dgauser, ts)';
  END IF;
END $$;
COMMENT ON INDEX idx_audit_slot IS
  'Busca todos los intentos de un slot específico. Usado por '
  'reconciler y UI de diagnóstico de slot.';

CREATE INDEX IF NOT EXISTS idx_audit_sent_at
  ON dga_send_audit (sent_at DESC);
COMMENT ON INDEX idx_audit_sent_at IS
  'Daily summary: rango de fechas de envíos. Cuenta envíos por día/obra.';

CREATE INDEX IF NOT EXISTS idx_audit_comprobante
  ON dga_send_audit (api_n_comprobante)
  WHERE api_n_comprobante IS NOT NULL;
COMMENT ON INDEX idx_audit_comprobante IS
  'Lookup por numeroComprobante para consulta SNIA GET '
  '/mediciones/subterraneas?codigoObra=X&numeroComprobante=Y.';

-- ============================================================================
-- SECCIÓN 4 — Convención de reg_map.parametros para offsets/scale
-- ============================================================================
-- reg_map.parametros (JSONB ya existe) almacena configuración por registro
-- Modbus que afecta la transformación de telemetría → valor reportado a DGA.
--
-- Esta sección NO altera schema: documenta el contrato JSON esperado por
-- el pipeline para casos especiales (hardcodes legacy migrados a config).
--
-- Convenciones JSON (ejemplos):
--
--   Site 44 (offset constante en totalizador):
--     reg_map (rol_dashboard='totalizador').parametros = {
--       "totalizator_offset": 4329
--     }
--     → reported = raw + 4329
--
--   Site 22 (offset negativo + base positiva, anomalía histórica):
--     reg_map (rol_dashboard='totalizador').parametros = {
--       "totalizator_base_minus": 1013701,
--       "totalizator_base_plus":  101357480
--     }
--     → reported = raw - 1013701 + 101357480
--
--   Equipos con escala ×10 (reemplaza devices_format_config.convert legacy):
--     reg_map.parametros = { "scale_factor": 10 }
--     → reported = raw / scale_factor
--     Default si no presente: scale_factor = 1.
--
--   Sensor reconocido como defectuoso (site 73):
--     reg_map (rol_dashboard='totalizador').parametros = {
--       "sensor_known_defective": true,
--       "defect_description": "totalizador siempre reporta 0"
--     }
--     → slot pasa a requires_review automáticamente. NO se asume 0 como
--       válido. Admin decide.
--
--   Totalizador word_swap (uint32 partido en 2 regs Modbus):
--     reg_map.parametros = { "word_swap": true }
--     → low/high words intercambiados al combinar d1 y d2.
--
-- WHY usar reg_map.parametros y no columnas en dga_user:
--   - Los offsets son propiedades del registro Modbus físico (sensor), no
--     del envío DGA. Si cambias de sensor, el offset cambia con él.
--   - JSONB permite agregar nuevas convenciones sin migrar schema.
--   - dga_user queda limpio para política de envío.

COMMENT ON COLUMN reg_map.parametros IS
  'JSONB con config del registro para transformaciones. Convenciones: '
  'totalizator_offset (int), totalizator_base_minus/_plus (int), '
  'scale_factor (int, default 1), word_swap (bool), '
  'sensor_known_defective (bool). Ver migración 2026-05-16-dga-pipeline-refactor.sql.';

-- ============================================================================
-- SECCIÓN 5 — Migración de datos existentes
-- ============================================================================
-- Backfill mínimo para alinear datos actuales con nuevo modelo.

-- Slots existentes con estatus='pendiente' antiguo permanecen 'pendiente'
-- (semántica preservada). No hacemos backfill a 'vacio' porque significaría
-- que el dato se relleno y validó OK → 'pendiente' es correcto.

-- next_retry_at = NULL en slots existentes → submission worker los toma
-- inmediatamente en el próximo tick. OK para slots ya enviados (estatus
-- != 'pendiente' los filtra). Para los pendientes legacy, primer reintento
-- inmediato es seguro porque attempts=0 (no riesgo §6.3 spam).

-- transport: dga_user existentes quedan en 'off' (default). Admin debe
-- activar explícitamente shadow/rest desde frontend. Comportamiento
-- conservador: nuevo schema NO envía a nadie hasta autorización gerencia.

-- ============================================================================
-- SECCIÓN 6 — Verificación
-- ============================================================================
-- Queries de verificación post-migración (no fallan si schema OK).

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Confirma que el nuevo enum de estatus está activo.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.check_constraints
  WHERE constraint_name = 'dato_dga_estatus_check';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'dato_dga_estatus_check no se creó';
  END IF;

  -- Confirma tabla audit.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dga_send_audit') THEN
    RAISE EXCEPTION 'tabla dga_send_audit no se creó';
  END IF;

  RAISE NOTICE 'DGA pipeline refactor: OK';
END $$;

COMMIT;

-- ============================================================================
-- FIN — Próximos pasos (NO en esta migración, sino en código aplicación):
--   1. Worker pre-seed (mensual + bootstrap-check) → INSERT slots 'vacio'.
--   2. Worker fill (cada minuto) → lee telemetría, valida, pasa a
--      'pendiente' o 'requires_review'.
--   3. Worker submission (cada 5min, ≥5min entre envíos del lote) → POST
--      a SNIA. UPDATE dato_dga + INSERT dga_send_audit en MISMA tx.
--   4. Worker reconciler (cada 1h) → compara audit vs dato_dga, corrige drift,
--      opcional GET SNIA por comprobante.
--   5. Importador CSV histórico → INSERT dato_dga (estatus='enviado',
--      totalizator_raw_legacy=decimal, flujo_acumulado=truncado) +
--      INSERT dga_send_audit (transport='legacy-import').
--   6. Frontend pozo: toggle activo + dropdown transport + caudal_max_lps.
--   7. UI admin requires_review queue con 2FA para aceptar fallback.
--   8. Alert: dga_atrasado ya existe en condicion check (24/48/72h).
-- ============================================================================
