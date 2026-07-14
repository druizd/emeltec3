# `dato_dga` — Hypertable de slots DGA

Un **slot** = un período de reporte DGA (generalmente 1 hora por `dga_periodicidad`).

---

## Schema

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `site_id` | `varchar(10) NOT NULL FK → sitio` | Sitio al que pertenece |
| `ts` | `timestamptz NOT NULL` | Timestamp UTC del período — dimensión temporal del hypertable |
| `fecha` | `date` (generada) | `ts` convertido a hora Chile (UTC-4) |
| `hora` | `time` (generada) | `ts` convertido a hora Chile (UTC-4) |
| `obra` | `varchar(150) NOT NULL` | Código obra DGA en SNIA |
| `caudal_instantaneo` | `numeric(12,3)` | L/s |
| `flujo_acumulado` | `numeric(14,3)` | m³ acumulado, **entero truncado** |
| `nivel_freatico` | `numeric(8,3)` | metros |
| `estatus` | `varchar(20) DEFAULT 'vacio'` | Estado del slot (ver flujo abajo) |
| `comprobante` | `text` | Número de comprobante SNIA (solo `estatus='enviado'`) |
| `intentos` | `smallint DEFAULT 0` | Cantidad de intentos de envío a SNIA |
| `next_retry_at` | `timestamptz` | Próximo reintento. NULL = inmediato en el siguiente tick |
| `ultimo_intento_at` | `timestamptz` | Timestamp del último intento |
| `fail_reason` | `text` | Último mensaje de error de SNIA o red |
| `validation_warnings` | `jsonb DEFAULT '[]'` | Anomalías de validación: `[{code, raw, suggested?, reason}]` |
| `totalizator_raw_legacy` | `numeric(14,3)` | Totalizador original con decimales (solo migración histórica) |

**PK:** `(site_id, ts)` — un único slot por sitio por período.

---

## Flujo de estados (`estatus`)

```
                      ┌──────────────────────────────┐
                      ▼                              │
vacio → pendiente → enviando → enviado              │ (comprobante SNIA ok)
             │           └──→ rechazado → pendiente ─┘ (1 retry/día, Res.2170 §6.2)
             │                         └──→ fallido  (N intentos agotados)
             │
             └──→ requires_review      (validación falla — requiere revisión manual)
                      └──→ pendiente   (tras corrección en UI)
```

**Valores válidos:** `vacio`, `pendiente`, `requires_review`, `enviando`, `enviado`, `rechazado`, `fallido`

---

## Validaciones al pasar a `pendiente`

El DGA fill worker (`modules/dga/worker.ts`) valida antes de mover de `vacio` a `pendiente`. Si falla → `requires_review`:

| Código | Condición | Acción |
|--------|-----------|--------|
| `sensor_defective` | `sensor_known_defective = true` en reg_map | → requires_review |
| `totalizador_zero` | totalizador = 0 o NULL | → requires_review con sugerencia |
| `caudal_negativo` | caudal < 0 | → requires_review |
| `caudal_spike` | caudal > caudal_max × tolerancia (o > 1000 L/s hardcode) | → requires_review |
| `all_null` | todos los valores null | → requires_review |

---

## Índices

| Índice | Columnas | Uso |
|--------|----------|-----|
| `dato_dga_pkey` | `(site_id, ts)` | Lookup por sitio+período |
| `dato_dga_ts_idx` | `ts DESC` | Queries por rango temporal |
| `idx_dato_dga_fecha` | `fecha DESC` | Queries por fecha Chile |
| `idx_dato_dga_pending_retry` | `(next_retry_at, site_id)` WHERE `estatus='pendiente'` | Cola de submission worker |
| `idx_dato_dga_review_queue` | `(site_id, ts DESC)` WHERE `estatus='requires_review'` | UI de revisión manual |

---

## Queries útiles

```sql
-- Estado de slots por sitio
SELECT estatus, COUNT(*)
FROM dato_dga
WHERE site_id = 'TU_SITE_ID'
GROUP BY estatus;

-- Slots pendientes de un sitio
SELECT ts, caudal_instantaneo, flujo_acumulado, intentos
FROM dato_dga
WHERE site_id = 'TU_SITE_ID' AND estatus = 'pendiente'
ORDER BY ts;

-- Slots en requires_review con warnings
SELECT ts, validation_warnings, fail_reason
FROM dato_dga
WHERE site_id = 'TU_SITE_ID' AND estatus = 'requires_review'
ORDER BY ts DESC LIMIT 20;

-- Slots enviados hoy
SELECT site_id, ts, comprobante
FROM dato_dga
WHERE fecha = CURRENT_DATE AND estatus = 'enviado'
ORDER BY ts DESC;
```

---

## Ver también

- [[../main-api/dga-pipeline]] — workers que manejan este ciclo
- [[empresa-sitio]] — relación site_id → sitio
- [[overview]] — arquitectura general
