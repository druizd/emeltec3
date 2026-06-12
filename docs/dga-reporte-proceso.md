# Reporte DGA — Proceso end-to-end

Documentación del pipeline completo de reporte a la DGA (Dirección General de
Aguas) vía SNIA, según el modelo redesign **2026-05-17**. Cubre desde la
configuración del pozo hasta el comprobante de envío.

> Complementa: [`dga-smoke-tests.md`](./dga-smoke-tests.md) (validación
> post-deploy) y [`main-api/ARCHITECTURE.md`](../main-api/ARCHITECTURE.md)
> (visión general del servicio).

---

## 1. Arquitectura — quién hace qué

| Pieza                       | Rol                                                                         |
| --------------------------- | --------------------------------------------------------------------------- |
| `main-api/src/modules/dga/` | **Pipeline vigente**: workers, validación, envío SNIA, 2FA, cripto          |
| `frontend-angular`          | Config del pozo (modal), tab DGA, cola de revisión (`/dga-review`)          |
| TimescaleDB                 | `dato_dga`, `dga_informante`, `dga_send_audit`, `pozo_config.dga_*`         |
| SNIA / MOP                  | Endpoint oficial `https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas` |

Archivos clave en `main-api/src/modules/dga/`:

| Archivo                                    | Qué hace                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `preseed.ts`                               | Crea slots `vacio` del mes corriente                                          |
| `worker.ts`                                | Llena slots con telemetría + valida (`vacio` → `pendiente`/`requires_review`) |
| `validation.ts`                            | Reglas de validación (puras, sin IO)                                          |
| `submission.ts`                            | Envía slots `pendiente` a SNIA + audit                                        |
| `snia-client.ts`                           | Cliente HTTP REST SNIA (Manual Técnico DGA 1/2025, Res. 2.170)                |
| `reconciler.ts`                            | Red de seguridad: corrige drift audit vs estado                               |
| `controller.ts` / `service.ts` / `repo.ts` | Endpoints HTTP, lógica, SQL                                                   |
| `crypto.ts`                                | AES-256 para `clave_informante` (`DGA_ENCRYPTION_KEY`)                        |
| `twofactor.ts`                             | OTP email (Resend) para mutaciones sensibles                                  |
| `notifier.ts`                              | Alertas email al admin (`MONITOR_PRIMARY_EMAIL`)                              |

---

## 2. Configuración (paso previo, manual)

### 2.1 Pool de informantes (global)

Admin crea informantes DGA (RUT + clave del portal SNIA) en el pool global:

- `GET/POST /api/v2/dga/informantes` — listar / crear
- `PATCH /api/v2/dga/informantes/:rut` — actualizar (**2FA si cambia clave**)
- `DELETE /api/v2/dga/informantes/:rut` — eliminar (**siempre 2FA**)

La clave se cifra con AES-256 (`DGA_ENCRYPTION_KEY`). Sin esa variable, el
alta falla con `DGA_KEY_MISSING`.

### 2.2 Config del pozo

Desde el frontend (modal "Configurar reporte DGA",
`dga-generar-reporte-modal.ts`) → `PATCH /api/v2/dga/sites/:siteId/pozo-config`.

Columnas en `pozo_config` (10):

| Campo                                  | Significado                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `dga_activo`                           | Switch maestro: habilita preseed + fill                                       |
| `dga_transport`                        | `off` \| `shadow` \| `rest` — solo `rest` envía real (**2FA para activarlo**) |
| `dga_periodicidad`                     | `hora` \| `dia` \| `semana` \| `mes`                                          |
| `dga_fecha_inicio` / `dga_hora_inicio` | Anclaje del primer slot                                                       |
| `dga_informante_rut`                   | FK al pool de informantes                                                     |
| `dga_caudal_max_lps`                   | Derecho de agua (límite de caudal)                                            |
| `dga_caudal_tolerance_pct`             | Tolerancia % sobre el derecho                                                 |
| `dga_max_retry_attempts`               | Reintentos antes de estado terminal `fallido`                                 |
| `dga_last_run_at`                      | Timestamp último fill exitoso                                                 |

Además `pozo_config.obra_dga` = código de obra DGA (`OB-XXXX-XXX`), requisito
para enviar.

---

## 3. Ciclo de vida del slot (`dato_dga.estatus`)

```
            preseed              fill worker                submission worker
  (no existe) ──→ vacio ──→ pendiente ──────────→ enviando ──→ enviado (terminal, con comprobante)
                    │             ▲                   │
                    │             │ accept (admin)    ├──→ rechazado ──(retry ≤ max)──→ pendiente
                    └──→ requires_review              │                └─(agotado)──→ fallido (terminal)
                              │
                              └──→ rechazado (discard admin)
```

7 estados: `vacio`, `pendiente`, `requires_review`, `enviando`, `enviado`,
`rechazado`, `fallido`. PK de `dato_dga` = `(site_id, ts)`.

---

## 4. Workers (todos en main-api)

| Worker         | Cadencia default                       | Flag env                       | Default                                      |
| -------------- | -------------------------------------- | ------------------------------ | -------------------------------------------- |
| **Preseed**    | bootstrap + 6h (`DGA_PRESEED_POLL_MS`) | `ENABLE_DGA_PRESEED_WORKER`    | `true`                                       |
| **Fill**       | 60s (`DGA_WORKER_POLL_MS`)             | `ENABLE_DGA_WORKER`            | `true`                                       |
| **Submission** | 5min (`DGA_SUBMISSION_POLL_MS`)        | `ENABLE_DGA_SUBMISSION_WORKER` | **`false`** (hasta autorización de gerencia) |
| **Reconciler** | 1h (`DGA_RECONCILER_POLL_MS`)          | `ENABLE_DGA_RECONCILER`        | `true`                                       |

### 4.1 Preseed (`preseed.ts`)

- Para cada pozo con `dga_activo=true` y config completa (periodicidad +
  fecha/hora inicio), genera los slots `vacio` del **mes corriente** en
  `dato_dga` con `generate_series` según periodicidad.
- Anclaje: `GREATEST(inicio de mes, fecha/hora inicio usuario)`, zona
  `Etc/GMT+4` (Chile sin DST).
- Idempotente: `ON CONFLICT (site_id, ts) DO NOTHING`.
- Pozo con config incompleta → log warn y se salta.

### 4.2 Fill (`worker.ts`)

- Itera pozos `dga_activo=true` (incluye `transport=off/shadow` — separar
  generación de envío permite modo sombra).
- Por cada slot `vacio` (máx 24 por pozo por ciclo, `DGA_WORKER_MAX_SLOTS`):
  1. **Match exacto**: busca bucket en `equipo_1min` con `bucket = slot.ts`
     (vía `getDashboardBucketExact`). Si no existe → slot queda `vacio` y
     reintenta próximo ciclo. **NO se usa lectura aproximada del window**
     porque comprometería consistencia dashboard ↔ DGA (el dato reportado a
     SNIA debe ser el mismo que muestra el dashboard, con idéntico timestamp).
  2. Aplica `mapHistoricalDashboardRow` (mismos mapeos `reg_map` del dashboard).
  3. Extrae `caudal` (L/s), `totalizador` (m³, truncado a entero),
     `nivel_freatico` (m).
  4. Valida (§5). OK → `pendiente`. Warnings → `requires_review` con
     `validation_warnings` JSON + `fail_reason`.

> **Pre-condición**: `pozo_config.dga_hora_inicio` debe estar minuto-alineada
> (segundos=00). El endpoint `PATCH pozo-config` snapea silenciosamente a
> `HH:MM:00`. Slots con ts a segundos ≠ 0 nunca encuentran bucket en
> `equipo_1min` (buckets son minuto-alineados via `time_bucket('1 minute', time)`).

### 4.3 Submission (`submission.ts`)

- Solo corre si `ENABLE_DGA_SUBMISSION_WORKER=true` **y** `DGA_RUT_EMPRESA`
  configurado. **Fail-fast**: si el flag está en `true` pero el RUT falta,
  el worker **no arranca** — emite log `error` + email a
  `MONITOR_PRIMARY_EMAIL` al bootstrap. Antes el worker arrancaba y omitía
  cada ciclo en silencio (cola pendiente crecía invisible).
- Toma hasta 50 slots `pendiente` por ciclo (`DGA_SUBMISSION_MAX_PER_CYCLE`)
  con `dga_transport='rest'` y `next_retry_at` vencido o NULL.
- **Throttle entre slots**: delay default `1s` (`DGA_SUBMISSION_DELAY_MS`)
  para evitar tráfico anómalo y bloqueo por SNIA (Res 2170 §6.1 + §7).
- Por slot:
  1. Pre-checks: `obra_dga` presente y con formato `^O[BR]-\d{4}-\d+$`
     (Res 2170 §5.2), informante asociado, clave descifrable. Falla →
     `rechazado` con `fail_reason` (`pozo_sin_codigo_obra`,
     `codigo_obra_formato_invalido`, `pozo_sin_informante`,
     `clave_decrypt_error`).
  2. **Anti-doble-envío** (Res 2170 §6.3): consulta `dga_send_audit` por
     audit OK existente para `(site_id, ts)`. Si existe → auto-fix a
     `enviado` con el comprobante guardado, sin reenviar. Evita ser bloqueado
     por DGA por retransmisión.
  3. Lock optimista: `pendiente` → `enviando` (evita doble envío entre
     instancias).
  4. POST a SNIA (§6).
  5. **Audit primero, estado después**: inserta fila en `dga_send_audit`
     antes de mover el estatus — si el proceso muere entre medio, el
     reconciler corrige el drift.
  6. Respuesta `status="00"` + `numeroComprobante` → `enviado` (guarda
     comprobante). Otro status → `rechazado` con
     `next_retry_at = now() + 24h` (Res 2170 §6.2: reintento al día
     siguiente). Intentos agotados (`dga_max_retry_attempts`) → `fallido`
     (terminal).

### 4.4 Reconciler (`reconciler.ts`)

Red de seguridad horaria, 5 chequeos:

| Check | Condición                                                                      | Acción                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Slot atascado en `enviando` > 15 min                                           | Auto-revierte a `pendiente`                                                                                                                              |
| B     | Audit dice OK pero estatus ≠ `enviado`                                         | Auto-fix a `enviado` con comprobante                                                                                                                     |
| C     | Slot `enviado` sin fila en audit                                               | **Solo alerta email** — no auto-corrige                                                                                                                  |
| D     | Doble envío OK del mismo slot                                                  | **Solo alerta email** — no auto-corrige                                                                                                                  |
| E     | Slot `vacio` con `ts < now() - 6h` (config `DGA_RECONCILER_STALE_VACIO_HOURS`) | **Alerta email digest** agrupada por sitio. Throttle in-memory: re-envía solo si el set cambió. **No se reportará a DGA** hasta que el dato real arribe. |

Alertas van a `MONITOR_PRIMARY_EMAIL`.

---

## 5. Reglas de validación (`validation.ts`)

Cualquier warning → `requires_review` (el primero define `fail_reason`):

| Código                       | Condición                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `sensor_known_defective`     | `reg_map.parametros.sensor_known_defective=true` en totalizador. Sugiere último totalizador válido    |
| `totalizator_zero`           | Totalizador 0 o NULL (sensor desconectado / reset firmware). Sugiere último válido                    |
| `flow_negative`              | Caudal < 0 (no esperado en pozo de extracción — posible sensor invertido / glitch). NO se envía a DGA |
| `flow_exceeds_water_right`   | `abs(caudal) > dga_caudal_max_lps × (1 + tolerancia%)` (puede coexistir con `flow_negative`)          |
| `flow_absurd_no_water_right` | Sin derecho cargado y `abs(caudal) > 1000 L/s` (fallback hardcode)                                    |
| `transform_failed_all_nulls` | Caudal, totalizador y nivel freático todos NULL (¿mapeo roto?)                                        |

---

## 6. Cliente SNIA (`snia-client.ts`)

Spec: Manual Técnico DGA 1/2025, Res. Exenta 2.170 (04-jul-2025).

- **Endpoint**: `POST https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas`
- **Headers**: `codigoObra`, `timeStampOrigen` (`yyyy-MM-ddTHH:mm:ss-0000`,
  donde `-0000` significa UTC-4 según el manual, no UTC)
- **Body**: `autenticacion{password, rutEmpresa, rutUsuario}` +
  `medicionSubterranea{caudal, fechaMedicion, horaMedicion, nivelFreaticoDelPozo, totalizador}`
- **Formatos** (SNIA rechaza si no cumplen):
  - `caudal`: string numérico, 2 decimales, L/s
  - `totalizador`: string entero sin decimales, m³, máx 15 chars
  - `nivelFreaticoDelPozo`: string, 2 decimales, m; vacío permitido en pozos
    de caudales muy pequeños
  - `fechaMedicion` / `horaMedicion`: hora local Chile (UTC-4 fijo)
- **Respuesta**: `{ status, message, data: { numeroComprobante } }` —
  `"00"` = OK; cualquier otro = rechazo.
- El password se descifra solo en memoria; en `dga_send_audit` el payload se
  guarda con password redactado (`****`).

---

## 7. Cola de revisión (frontend `/dga-review`)

Slots `requires_review` requieren decisión manual de SuperAdmin/Admin:

1. `GET /api/v2/dga/review-queue` — lista slots con warnings.
2. Admin pide OTP: `POST /api/v2/dga/2fa/request` (email al usuario
   solicitante, expira 5 min).
3. `POST /api/v2/dga/review-queue/action` (header `X-DGA-2FA-Code`):
   - **accept** — opcionalmente con valor corregido (ej. último totalizador
     válido sugerido) → slot pasa a `pendiente` (entra a cola de envío).
   - **discard** → slot pasa a `rechazado`.

2FA email-OTP también aplica a: cambio de `clave_informante`, activar
`dga_transport='rest'`, eliminar informante.

---

## 8. Consulta y exportación

| Endpoint                            | Uso                                                      |
| ----------------------------------- | -------------------------------------------------------- |
| `GET /dga/sites/:id/live-preview`   | Último dato validado listo para envío (preview en modal) |
| `GET /dga/sites/:id/ultimo-envio`   | Último envío exitoso (comprobante)                       |
| `GET /dga/dato?site=&desde=&hasta=` | Mediciones por sitio + rango                             |
| `GET /dga/dato/export.csv`          | CSV de `dato_dga`                                        |
| `GET /dga/export-directo.csv`       | CSV agregado directo del equipo                          |

UI: tab DGA en detalle de sitio agua (`company-site-canal-detail.ts`) muestra
tabla con badges Enviado/Pendiente/Rechazado + comprobantes.

Alertas relacionadas: trigger `dga_atrasado` (módulo `alerts`) + resumen en
`healthDigest`.

---

## 9. Variables de entorno

| Variable                                                                                           | Requerida  | Default      | Notas                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ---------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `DGA_ENCRYPTION_KEY`                                                                               | ✅         | —            | AES-256 claves informantes                                                                                       |
| `DGA_RUT_EMPRESA`                                                                                  | ✅ (envío) | —            | RUT Centro de Control Emeltec. Si `ENABLE_DGA_SUBMISSION_WORKER=true` y falta → worker NO arranca + alerta email |
| `ENABLE_DGA_SUBMISSION_WORKER`                                                                     | —          | `false`      | **Mantener `false` hasta autorización de gerencia**                                                              |
| `ENABLE_DGA_WORKER`                                                                                | —          | `true`       | Fill                                                                                                             |
| `ENABLE_DGA_PRESEED_WORKER`                                                                        | —          | `true`       | Preseed                                                                                                          |
| `ENABLE_DGA_RECONCILER`                                                                            | —          | `true`       | Reconciler                                                                                                       |
| `MONITOR_PRIMARY_EMAIL`                                                                            | —          | —            | Alertas reconciler (no el 2FA — ese va al email del solicitante)                                                 |
| `RESEND_API_KEY`                                                                                   | ✅ (2FA)   | —            | OTP email                                                                                                        |
| `DGA_SUBMISSION_POLL_MS` / `DGA_WORKER_POLL_MS` / `DGA_PRESEED_POLL_MS` / `DGA_RECONCILER_POLL_MS` | —          | 5m/60s/6h/1h | Cadencias                                                                                                        |
| `DGA_RECONCILER_STALE_VACIO_HOURS`                                                                 | —          | `6`          | Threshold (horas) para alerta E (slots vacio sin dato). Subir si red intermitente esperada                       |
| `DGA_RECONCILER_STUCK_MIN`                                                                         | —          | `15`         | Minutos antes de revertir slot atascado en `enviando` (check A)                                                  |
| `DGA_SUBMISSION_DELAY_MS`                                                                          | —          | `1000`       | Delay entre cada slot en `runSubmissionCycle`. Evita ráfagas → bloqueo SNIA (Res 2170 §6.1 + §7)                 |

---

## 10. Pendientes / deuda conocida

- **`dga-api` (servicio legacy)**: sigue en `docker-compose.yml` con
  ingestion worker activo por default, pero referencia la tabla `dga_user`
  ya droppeada. Decomisionar (el frontend y main-api ya no lo usan salvo
  health-check en `statusController.js`).
- **Submission real**: `ENABLE_DGA_SUBMISSION_WORKER=false` en prod hasta
  cutover autorizado.

---

## 11. Migraciones relevantes

```
infra-db/migrations/2026-05-12-dga-reporte.sql
infra-db/migrations/2026-05-14-alert-dga-atrasado.sql
infra-db/migrations/2026-05-14-dga-submission-tracking.sql
infra-db/migrations/2026-05-16-dga-pipeline-refactor.sql
infra-db/migrations/2026-05-17-dga-pozo-config-redesign.sql
infra-db/migrations/2026-06-11-drop-dga-auto-accept-fallback.sql
```

Tests: `main-api/src/modules/dga/__tests__/` (vitest).
