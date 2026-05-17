# DGA Smoke Tests — Validación post-deploy

Conjunto de queries SQL + checks de logs para validar que el pipeline DGA
está sano tras cada deploy. Correr en la VM de producción.

> **Acceso DB**: `docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb psql -U postgres -d telemetry_platform`
> Credenciales viven en `~/emeltec3/.env` (`POSTGRES_USER` / `POSTGRES_DB`).
> **NO** usar `admin_infra` / `db_infra` — esos son los defaults del compose
> local (`infra-db/docker-compose.yml`), no aplican en prod.

---

## 1. Migraciones aplicadas

Verificar que el schema DGA está en su versión actual.

### 1.a. Tabla `dga_informante` (pool global)

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c "\d dga_informante"
```

**Esperado**: columnas `rut PK, clave_informante, referencia, created_at, updated_at`.

### 1.b. Columnas DGA en `pozo_config` (11 esperadas)

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c \
  "SELECT column_name FROM information_schema.columns
    WHERE table_name='pozo_config' AND column_name LIKE 'dga_%'
    ORDER BY column_name;"
```

**Esperado** (11 filas):

```
dga_activo
dga_auto_accept_fallback_hours
dga_caudal_max_lps
dga_caudal_tolerance_pct
dga_fecha_inicio
dga_hora_inicio
dga_informante_rut
dga_last_run_at
dga_max_retry_attempts
dga_periodicidad
dga_transport
```

### 1.c. `dga_user` droppeada + `dato_dga.site_id` existe

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c \
  "SELECT to_regclass('public.dga_user') AS dga_user_existe,
          EXISTS(SELECT 1 FROM information_schema.columns
                  WHERE table_name='dato_dga' AND column_name='site_id') AS dato_site_id;"
```

**Esperado**:

```
 dga_user_existe | dato_site_id
-----------------+--------------
                 | t
```

(`dga_user_existe` debe estar vacío = NULL = no existe.)

### 1.d. Enum estatus en `dato_dga` (7 valores)

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname='dato_dga_estatus_check';"
```

**Esperado**: incluye `vacio`, `pendiente`, `requires_review`, `enviando`,
`enviado`, `rechazado`, `fallido`.

### 1.e. Tabla audit append-only

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c "\d dga_send_audit"
```

**Esperado**: `site_id, ts, attempt_n, transport, http_status, dga_status_code, api_n_comprobante, request_payload, raw_response, sent_at, duration_ms`.

---

## 2. Workers iniciados

```bash
docker compose -f ~/emeltec3/docker-compose.yml logs main-api --since 5m \
  | grep -iE "dga" | tail -30
```

**Esperado** (4 mensajes al arranque):

```
DGA fill worker iniciado          (intervalMs: 60000)
DGA preseed worker iniciado       (intervalMs: 21600000 = 6h)
DGA submission worker deshabilitado (ENABLE_DGA_SUBMISSION_WORKER=false)
DGA reconciler iniciado           (intervalMs: 3600000 = 1h)
```

Si `submission worker iniciado` en lugar de `deshabilitado`: revisar
`ENABLE_DGA_SUBMISSION_WORKER` en `.env` — por defecto debe estar `false`
hasta cutover real.

---

## 3. Estado de datos

### 3.a. Conteo pozos + informantes

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c \
  "SELECT
     (SELECT COUNT(*) FROM sitio WHERE tipo_sitio='pozo' AND activo=TRUE)   AS pozos_activos,
     (SELECT COUNT(*) FROM pozo_config WHERE dga_activo=TRUE)               AS pozos_dga_activos,
     (SELECT COUNT(*) FROM dga_informante)                                  AS informantes,
     (SELECT COUNT(*) FROM dato_dga WHERE estatus='vacio')                  AS slots_vacios,
     (SELECT COUNT(*) FROM dato_dga WHERE estatus='pendiente')              AS slots_pendientes,
     (SELECT COUNT(*) FROM dato_dga WHERE estatus='requires_review')        AS slots_review,
     (SELECT COUNT(*) FROM dato_dga WHERE estatus='enviado')                AS slots_enviados;"
```

### 3.b. Pozos con DGA activo pero config incompleta

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c \
  "SELECT sitio_id, obra_dga, dga_periodicidad, dga_fecha_inicio,
          dga_hora_inicio, dga_informante_rut
     FROM pozo_config
    WHERE dga_activo = TRUE
      AND (obra_dga IS NULL OR dga_periodicidad IS NULL
           OR dga_fecha_inicio IS NULL OR dga_hora_inicio IS NULL
           OR dga_informante_rut IS NULL);"
```

**Esperado**: 0 filas. Si hay filas: ese pozo no podrá generar slots ni
enviar; completar desde el modal "Configurar reporte DGA".

### 3.c. Pozos en transport=rest sin informante (riesgo)

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c \
  "SELECT sitio_id FROM pozo_config
    WHERE dga_transport='rest' AND (dga_informante_rut IS NULL OR NOT dga_activo);"
```

**Esperado**: 0. Si hay → pozo no enviará y se llena la cola pendiente.

---

## 4. Endpoints HTTP

### 4.a. Health check

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v2/health/live
```

**Esperado**: `200`.

### 4.b. Endpoints DGA responden (requiere JWT)

```bash
TOKEN="<JWT admin>"
curl -s -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/api/v2/dga/informantes | head -c 200
```

**Esperado**: `{"ok":true,"data":[...]}`.

### 4.c. Live preview de un sitio

```bash
SITE="S100"
curl -s -H "Authorization: Bearer $TOKEN" \
     "http://localhost:3000/api/v2/dga/sites/${SITE}/live-preview" | head -c 400
```

**Esperado**: JSON con `ts, fechaMedicion, horaMedicion, caudal,
totalizador, nivelFreaticoDelPozo, age_seconds`.

---

## 5. Hallazgos del reconciler (últimas 24h)

```bash
docker compose -f ~/emeltec3/docker-compose.yml logs main-api --since 24h \
  | grep -iE "reconciler" | tail -20
```

**Esperado** (si todo bien): solo `ciclo OK sin hallazgos` o el ciclo de
arranque. Si aparece `reconciler (C)` o `reconciler (D)`: revisar
emails enviados a `MONITOR_PRIMARY_EMAIL` y actuar manualmente.

---

## 6. Cuándo correr cada check

| Cuándo | Checks |
|---|---|
| **Post-deploy** | §1, §2 — verifica que migración y workers están OK |
| **Diario** | §3, §5 — estado de datos + hallazgos reconciler |
| **Tras activar transport=rest en un pozo** | §3.b, §3.c — config completa, informante asociado |
| **Si admin reporta problema** | §4 — endpoints responden |

---

## 7. Variables de entorno críticas

```bash
grep -E "POSTGRES_USER|POSTGRES_DB|DGA_API_URL|DGA_RUT_EMPRESA|\
ENABLE_DGA_SUBMISSION_WORKER|ENABLE_DGA_PRESEED_WORKER|\
ENABLE_DGA_WORKER|ENABLE_DGA_RECONCILER|DGA_ENCRYPTION_KEY|\
MONITOR_PRIMARY_EMAIL" ~/emeltec3/.env
```

**Críticos**:

- `DGA_ENCRYPTION_KEY` — sin esto, alta de informante con clave falla
  (`DGA_KEY_MISSING`).
- `DGA_RUT_EMPRESA` — RUT del Centro de Control Emeltec; sin esto el
  submission worker omite ciclo.
- `MONITOR_PRIMARY_EMAIL` — destino del 2FA email-OTP y de las alertas
  del reconciler.
- `ENABLE_DGA_SUBMISSION_WORKER=false` (default) — mantener `false`
  hasta autorización de gerencia para enviar a SNIA real.
