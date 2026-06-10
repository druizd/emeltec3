# main-api — Arquitectura

API principal de Emeltec Cloud. Node.js + Express 5 + TypeScript (compilado). Dos interfaces: **HTTP REST** (puerto 3000) y **gRPC** (puerto 50051).

---

## Arranque

```
src/server.js          ← Entry point
  └── src/app.js       ← Express config + rutas legacy (v1)
  └── dist/http/v2/    ← Rutas TypeScript compiladas (v2)
  └── 9 workers        ← Se inician al levantar HTTP
```

`server.js` inicia Express, luego gRPC, luego dispara todos los workers en background. Graceful shutdown en SIGINT/SIGTERM.

---

## Estructura de rutas

### v1 — Legacy CommonJS (`/api/*`)

| Prefijo           | Módulo                      |
| ----------------- | --------------------------- |
| `/api/health`     | health check básico         |
| `/api/data`       | telemetría legacy           |
| `/api/users`      | usuarios                    |
| `/api/companies`  | empresas                    |
| `/api/alertas`    | alertas                     |
| `/api/documentos` | documentos                  |
| `/api/audit-log`  | log de auditoría Ley 21.663 |

### v2 — TypeScript (`/api/v2/*`)

#### Telemetría (sin auth)

| Método | Ruta                | Qué hace                                    |
| ------ | ------------------- | ------------------------------------------- |
| GET    | `/telemetry`        | Histórico por serial, keys, rango de fechas |
| GET    | `/telemetry/latest` | Último valor por serial                     |
| GET    | `/telemetry/online` | Seriales online ahora                       |
| GET    | `/telemetry/preset` | Ventanas predefinidas (24h/7d/30d/365d)     |
| GET    | `/telemetry/keys`   | Keys disponibles para un serial             |

#### Auth (sin auth)

| Método | Ruta                 | Qué hace                   |
| ------ | -------------------- | -------------------------- |
| POST   | `/auth/login`        | Email + password → JWT     |
| POST   | `/auth/request-code` | Email → OTP 2FA vía Resend |

#### Sites y Companies (requiere JWT)

| Método | Ruta                           | Qué hace                         |
| ------ | ------------------------------ | -------------------------------- |
| GET    | `/sites/:id/dashboard-data`    | Snapshot salud + métricas        |
| GET    | `/sites/:id/dashboard-history` | Serie de tiempo (cacheado Redis) |
| GET    | `/companies/tree`              | Árbol jerárquico por módulos     |

#### DGA — Informantes (JWT + 2FA en mutaciones sensibles)

| Método | Ruta                    | Qué hace                               |
| ------ | ----------------------- | -------------------------------------- |
| GET    | `/dga/informantes`      | Lista pool global de informantes       |
| POST   | `/dga/informantes`      | Crear/actualizar (2FA si cambia clave) |
| PATCH  | `/dga/informantes/:rut` | Actualizar (2FA si cambia clave)       |
| DELETE | `/dga/informantes/:rut` | Eliminar (siempre 2FA)                 |

#### DGA — Pozo Config (JWT + 2FA si transport=rest)

| Método | Ruta                          | Qué hace                              |
| ------ | ----------------------------- | ------------------------------------- |
| GET    | `/dga/sites/:id/pozo-config`  | Config DGA del pozo                   |
| PATCH  | `/dga/sites/:id/pozo-config`  | Actualizar config (2FA si rest)       |
| GET    | `/dga/sites/:id/live-preview` | Último dato validado listo para envío |
| GET    | `/dga/sites/:id/ultimo-envio` | Último envío exitoso a SNIA           |

#### DGA — Mediciones (JWT)

| Método | Ruta                      | Qué hace                       |
| ------ | ------------------------- | ------------------------------ |
| GET    | `/dga/dato`               | Consultar mediciones por sitio |
| GET    | `/dga/dato/export.csv`    | CSV de dato_dga                |
| GET    | `/dga/export-directo.csv` | CSV directo del equipo         |

#### DGA — Cola de revisión (JWT + 2FA obligatorio)

| Método | Ruta                       | Qué hace                                             |
| ------ | -------------------------- | ---------------------------------------------------- |
| POST   | `/dga/2fa/request`         | Pedir OTP (enviado al email del usuario solicitante) |
| GET    | `/dga/review-queue`        | Slots pendientes de revisión admin                   |
| POST   | `/dga/review-queue/action` | Aceptar/descartar slot                               |

#### Bitácora Sitio (JWT)

| Método | Ruta                          | Qué hace                |
| ------ | ----------------------------- | ----------------------- |
| GET    | `/sites/:id/bitacora/ficha`   | Ficha técnica del sitio |
| PATCH  | `/sites/:id/bitacora/ficha`   | Actualizar ficha        |
| GET    | `/sites/:id/bitacora/equipos` | Lista equipos           |
| POST   | `/sites/:id/bitacora/equipos` | Agregar equipo          |
| PATCH  | `/sites/bitacora/equipos/:id` | Actualizar equipo       |
| DELETE | `/sites/bitacora/equipos/:id` | Eliminar equipo         |

#### Análisis (JWT)

| Método | Ruta                           | Qué hace               |
| ------ | ------------------------------ | ---------------------- |
| GET    | `/sites/:id/analisis/salud`    | Health score del sitio |
| GET    | `/sites/:id/analisis/metricas` | Resumen de métricas    |

---

## Módulos (`src/modules/`)

| Módulo                | Responsabilidad                                                                  |
| --------------------- | -------------------------------------------------------------------------------- |
| `auth`                | Login JWT, OTP request                                                           |
| `telemetry`           | Consultas timeseries, keys, presets                                              |
| `sites`               | Metadata sitios, pozo_config, reg_map, dashboard                                 |
| `companies`           | Árbol empresa → sub_empresa → sitio                                              |
| `dga`                 | Pipeline DGA completo: pool informantes, slots dato_dga, envío SNIA, 2FA, cripto |
| `bitacoraSitio`       | Ficha técnica + inventario equipos por sitio                                     |
| `analisis`            | Health score + métricas resumen                                                  |
| `contadores`          | Agregación mensual energía/volumen                                               |
| `metrics`             | Buffer in-memory → flush DB cada 5s                                              |
| `health`              | Liveness, readiness, Prometheus                                                  |
| `healthDigest`        | Resúmenes transmisión + DGA                                                      |
| `siteOperacionConfig` | Config turnos operación                                                          |
| `alerts`              | Worker alertas (legacy)                                                          |

---

## Workers en background

| Worker          | Frecuencia | Qué hace                                               |
| --------------- | ---------- | ------------------------------------------------------ |
| Metrics Flusher | cada 5s    | Vacía buffer in-memory → tabla `equipo`                |
| DGA Worker      | cada 60s   | Llena slots `vacio` → `pendiente` con datos del equipo |
| DGA Preseed     | mensual    | Crea slots `vacio` del mes siguiente                   |
| DGA Submission  | diario     | Envía slots `pendiente` a SNIA (OFF por defecto)       |
| DGA Reconciler  | periódico  | Detecta drift/slots atascados                          |
| Health Digest   | diario     | Resumen salud transmisión (OFF por defecto)            |
| Contadores      | cada 1h    | Recomputa contadores mensuales                         |
| Cache Warmer    | cada 50s   | Precalienta dashboard-history en Redis                 |
| Alerta Service  | continuo   | Evaluación de alertas (legacy)                         |

---

## Base de datos

**TimescaleDB** (PostgreSQL 16 + extensión timescaledb). Docker container: `emeltec-db`.

| Tabla                   | Tipo                   | Descripción                                         |
| ----------------------- | ---------------------- | --------------------------------------------------- |
| `sitio`                 | normal                 | Instalaciones/pozos                                 |
| `equipo`                | hypertable             | Telemetría timeseries (time, id_serial, data JSONB) |
| `pozo_config`           | normal                 | Config DGA por sitio                                |
| `reg_map`               | normal                 | Mapeo variables: alias, unidad, rol_dashboard       |
| `dato_dga`              | normal PK(sitio_id,ts) | Mediciones DGA con estado del slot                  |
| `dga_informante`        | normal                 | Pool global informantes (clave cifrada AES-256)     |
| `dga_send_audit`        | normal                 | Log de envíos a SNIA                                |
| `usuario`               | normal                 | Usuarios con roles                                  |
| `empresa`               | normal                 | Empresas cliente                                    |
| `sub_empresa`           | normal                 | Sub-empresas                                        |
| `bitacora_sitio_ficha`  | normal                 | Ficha técnica del sitio                             |
| `equipo_bitacora`       | normal                 | Inventario equipos                                  |
| `site_contador_mensual` | normal                 | Contadores mensuales                                |
| `bitacora_audit`        | normal                 | Log mutaciones Ley 21.663                           |

### Ciclo de vida slot DGA

```
vacio  →  pendiente  →  aceptado
                    ↘  requires_review  →  aceptado / rechazado
```

---

## Auth y permisos

**JWT HS256** — header `Authorization: Bearer <token>`.

| Rol          | Alcance                                           |
| ------------ | ------------------------------------------------- |
| `SuperAdmin` | Todo, sin filtro de tenant                        |
| `Admin`      | Toda la empresa                                   |
| `Empresa`    | Solo su empresa                                   |
| `Gerente`    | Empresa + sub_empresa asignada                    |
| `Cliente`    | Empresa + sub_empresa asignada (lectura limitada) |
| `SubEmpresa` | Igual que Cliente                                 |

**2FA vía OTP email** (Resend API) — requerido en:

- Cambio de `clave_informante` DGA
- Config `dga_transport = rest`
- Acciones en review-queue

---

## Integraciones externas

| Sistema        | Cómo                              | Para qué                                 |
| -------------- | --------------------------------- | ---------------------------------------- |
| **SNIA / MOP** | REST POST (DGA submission worker) | Enviar mediciones mensuales a DGA        |
| **Azure Blob** | `@azure/storage-blob` SDK         | Documentos bitácora (ficha, reportes)    |
| **Resend**     | API HTTP                          | Emails OTP 2FA                           |
| **Prometheus** | `prom-client`                     | Métricas de proceso para monitoreo       |
| **gRPC**       | `@grpc/grpc-js`                   | Comunicación interna con otros servicios |
| **Redis**      | `ioredis`                         | Cache dashboard-history + rate limiting  |

---

## Variables de entorno clave

| Variable                          | Requerida  | Default      | Qué hace                        |
| --------------------------------- | ---------- | ------------ | ------------------------------- |
| `JWT_SECRET`                      | ✅         | —            | Firma JWT (min 16 chars)        |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | ✅         | —            | PostgreSQL                      |
| `DGA_ENCRYPTION_KEY`              | ✅ (DGA)   | —            | AES-256 para claves informantes |
| `DGA_RUT_EMPRESA`                 | ✅ (envío) | —            | RUT Emeltec registrado en DGA   |
| `RESEND_API_KEY`                  | ✅ (2FA)   | —            | Email OTP                       |
| `MONITOR_PRIMARY_EMAIL`           | ❌         | —            | Destinatario alertas reconciler |
| `REDIS_URL`                       | ❌         | noop         | Cache + rate limit              |
| `AZURE_STORAGE_CONNECTION_STRING` | ❌         | 503 si falta | Documentos blob                 |
| `ENABLE_DGA_SUBMISSION_WORKER`    | ❌         | `false`      | Activar envío real a SNIA       |
| `CORS_ORIGIN`                     | ❌         | `*`          | Whitelist CORS                  |

---

## Stack técnico

| Capa       | Tecnología                          |
| ---------- | ----------------------------------- |
| Runtime    | Node.js 24+                         |
| HTTP       | Express 5                           |
| Lenguaje   | TypeScript (src/) + CommonJS legacy |
| DB driver  | `pg` v8                             |
| Cache      | Redis (`ioredis`)                   |
| Validación | Zod (v2) + manual (legacy)          |
| Logging    | Pino (v2) + Morgan (legacy)         |
| Seguridad  | Helmet, CORS, rate-limit Redis      |
| Monitoreo  | Prometheus (`prom-client`)          |
