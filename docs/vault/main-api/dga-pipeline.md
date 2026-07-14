# DGA Pipeline

Pipeline completo para generar y enviar reportes DGA a SNIA (Dirección General de Aguas).

---

## Flujo general

```
pozo_config.dga_activo = true
  ↓
[preseed worker]   — crea slots vacio para períodos futuros/pasados
  ↓
dato_dga.estatus = 'vacio'
  ↓
[fill worker]      — lee equipo_1min, valida, llena valores
  ↓
dato_dga.estatus = 'pendiente' | 'requires_review'
  ↓
[submission worker] — envía a SNIA REST (solo si dga_transport='rest')
  ↓
dato_dga.estatus = 'enviado' | 'rechazado' | 'fallido'
  ↓
[reconciler]       — corrige estados inconsistentes (enviando → rechazado, etc.)
[gcs-exporter]     — exporta a Google Cloud Storage como Parquet (si dga_gcs_export=true)
```

---

## Workers

### `startDgaPreseedWorker` — `modules/dga/preseed.ts`

Crea los slots `vacio` en `dato_dga` para cada pozo activo.
- Itera pozos con `pozo_config.dga_activo = true`
- Calcula el rango de timestamps según `dga_periodicidad` y `dga_fecha_inicio`
- INSERT de slots `vacio` (ON CONFLICT DO NOTHING)

### `startDgaWorker` — `modules/dga/worker.ts`

Fill worker. El más importante del pipeline.

**Ciclo (cada `DGA_WORKER_POLL_MS`, default 60s):**
1. Lista pozos con `dga_activo = true` (incluye `transport='off'/'shadow'`)
2. Por cada pozo: lista hasta `DGA_WORKER_MAX_SLOTS` (default 24) slots `vacio`
3. Por cada slot:
   a. Busca bucket exacto en `equipo_1min` para ese `(id_serial, ts)`
   b. Si no existe → `no_data` (dato aún no llegó, reintenta próximo ciclo)
   c. Mapea valores usando `reg_map` (caudal, totalizador, nivel_freatico)
   d. Valida (ver reglas abajo)
   e. Transiciona a `pendiente` o `requires_review`

**Reglas de validación** (`modules/dga/validation.ts`):

| Código | Condición | Resultado |
|--------|-----------|-----------|
| `sensor_defective` | `sensor_known_defective=true` en reg_map | → `requires_review` |
| `totalizador_zero` | totalizador = 0 o NULL | → `requires_review` con sugerencia del último válido |
| `caudal_negativo` | caudal < 0 | → `requires_review` |
| `caudal_spike` | caudal > `caudal_max × tolerance` (fallback: > 1000 L/s) | → `requires_review` |
| `all_null` | todos los valores son NULL | → `requires_review` |
| ok | ninguna regla falla | → `pendiente` |

Constantes: `FROZEN_WINDOW_DEFAULT_N = 4`, `FLOW_HARDCODE_LIMIT_LPS = 1000`

### `startDgaSubmissionWorker` — `modules/dga/submission.ts`

Envía slots `pendiente` a SNIA.
- **Deshabilitado por defecto** — requiere `ENABLE_DGA_SUBMISSION_WORKER=true`
- Solo envía pozos con `dga_transport = 'rest'`
- Llama a `modules/dga/snia-client.ts` (cliente REST SNIA)
- Transiciones: `pendiente → enviando → enviado | rechazado`
- Retry: 1 intento por día (Res. 2170 §6.2). `next_retry_at = now() + 24h`
- Tras `dga_max_retry_attempts` rechazos → `fallido`

### `startDgaReconcilerWorker` — `modules/dga/reconciler.ts`

Corrige estados inconsistentes:
- Slots `enviando` que llevan demasiado tiempo → `rechazado`
- Slots `rechazado` con `next_retry_at` pasado → `pendiente`

### `startDgaGcsExporter` — `modules/dga/gcs-exporter.ts`

Exporta datos DGA a Google Cloud Storage en formato Parquet.
- Se activa por sitio con `pozo_config.dga_gcs_export = true`
- Requiere `DGA_GCS_EMPRESA_ID` + `GOOGLE_APPLICATION_CREDENTIALS` en env
- Log en tabla `dga_gcs_export_log`

---

## `dga_informante`

Pool global de credenciales SNIA. Un informante puede firmar múltiples pozos.

| Columna | Descripción |
|---------|-------------|
| `rut` | PK — RUT del informante |
| `clave_informante` | Clave SNIA (cifrada en DB con `modules/dga/crypto.ts`) |
| `referencia` | Nota libre |

FK desde `pozo_config.dga_informante_rut → dga_informante.rut`

## `dga_send_audit`

Log de cada intento de envío: timestamp, respuesta raw de SNIA, código error, `site_id`.

---

## Two-factor para acciones sensibles

Cambiar `dga_transport` a `'rest'` requiere 2FA (`modules/dga/twofactor.ts`).
El step-up 2FA usa `routes/twoFactorRoutes.js` + `shared/stepUp2fa.js`.

---

## UI — DGA Review

Página `dga-review` en el frontend muestra todos los slots `requires_review`.
Permite al operador corregir valores y mover el slot a `pendiente`.

---

## Queries útiles de diagnóstico

```sql
-- Pozos activos con DGA
SELECT s.id, s.descripcion, p.dga_transport, p.dga_periodicidad, p.dga_last_run_at
FROM pozo_config p JOIN sitio s ON s.id = p.sitio_id
WHERE p.dga_activo = true;

-- Slots vacio por pozo (sin datos aún)
SELECT site_id, COUNT(*) as vacios
FROM dato_dga WHERE estatus = 'vacio'
GROUP BY site_id;

-- Cola de requires_review
SELECT site_id, ts, validation_warnings
FROM dato_dga WHERE estatus = 'requires_review'
ORDER BY ts;

-- Enviados hoy
SELECT site_id, ts, comprobante
FROM dato_dga WHERE fecha = CURRENT_DATE AND estatus = 'enviado';
```

---

## Ver también

- [[../db/dato-dga]] — schema de `dato_dga`
- [[../db/empresa-sitio]] — schema de `pozo_config`
- [[../db/reg-map]] — cómo se mapean los valores de telemetría
- [[auth]] — permisos para gestionar DGA
