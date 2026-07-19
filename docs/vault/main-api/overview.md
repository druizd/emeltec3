# main-api — Overview

API principal de Emeltec Cloud. Monolito Express con módulos TypeScript y workers de background.

**Stack:** Node.js · Express · TypeScript (módulos nuevos) + JS (legacy) · PostgreSQL (pg) · pino (logs) · gRPC

---

## Estructura de carpetas

```
main-api/src/
  app.js                    — Express app, middlewares globales
  server.js                 — Entry point: HTTP + gRPC + arranque de workers
  grpc/server.js            — Servidor gRPC (recibe telemetría)
  config/
    db.js                   — Pool PostgreSQL (pg)
    env.js                  — Variables de entorno tipadas
    logger.ts               — Pino logger (JSON en prod, pretty en dev)
    siteTypeCatalog.js      — Catálogo de tipos de sitio
  controllers/              — Controladores Express (JS legacy)
  routes/                   — Rutas Express
  middlewares/              — Auth, errores, acceso por serial
  services/                 — Servicios de negocio (JS)
  modules/                  — Módulos TypeScript (arquitectura nueva)
  utils/                    — Utilidades (caudal, ieee754, nivel freático, RUT, etc.)
```

---

## Módulos TypeScript (`src/modules/`)

| Módulo                 | Descripción                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `analisis/`            | Análisis predictivo y de salud de sitios                                  |
| `alerts/`              | Worker de evaluación de alertas en tiempo real                            |
| `auth/`                | Autenticación JWT, OTP, sesiones                                          |
| `bitacoraSitio/`       | Bitácora de eventos por sitio                                             |
| `companies/`           | Gestión de empresas y sitios                                              |
| `contadores/`          | Worker de contadores mensuales                                            |
| `dga/`                 | Pipeline completo DGA (fill, preseed, submission, reconciler, GCS export) |
| `health/`              | Endpoints de salud de la API                                              |
| `healthDigest/`        | Worker de monitoreo de usuarios DGA                                       |
| `metrics/`             | Buffer y flusher de métricas de uso                                       |
| `simulation/`          | Worker de simulación Mathei (experimental)                                |
| `siteOperacionConfig/` | Config de operación por sitio                                             |
| `sites/`               | Repositorio y servicio de sitios, cache warmer                            |
| `telemetry/`           | Repositorio y servicio de telemetría (lectura de `equipo`)                |

---

## Workers de background

Todos arrancan en `server.js` tras `app.listen()`. Usan `try/catch MODULE_NOT_FOUND` para no fallar si el módulo no existe en dev.

| Worker                        | Módulo                            | Habilitado por defecto                                    |
| ----------------------------- | --------------------------------- | --------------------------------------------------------- |
| `alertaService`               | `services/alertaService.js`       | Sí                                                        |
| `startMetricsFlusher`         | `modules/metrics/flusher`         | Sí                                                        |
| `startDgaWorker`              | `modules/dga/worker`              | Sí — fill `vacio` → `pendiente`                           |
| `startDgaPreseedWorker`       | `modules/dga/preseed`             | Sí — crea slots `vacio` futuros                           |
| `startDgaSubmissionWorker`    | `modules/dga/submission`          | **No** — requiere `ENABLE_DGA_SUBMISSION_WORKER=true`     |
| `startDgaGcsExporter`         | `modules/dga/gcs-exporter`        | **No** — requiere `DGA_GCS_EMPRESA_ID` + credenciales GCS |
| `startDgaReconcilerWorker`    | `modules/dga/reconciler`          | Sí — reconcilia estados inconsistentes                    |
| `startHealthDigestWorker`     | `modules/healthDigest/worker`     | Sí                                                        |
| `startContadoresWorker`       | `modules/contadores/worker`       | Sí                                                        |
| `startMatheiSimulationWorker` | `modules/simulation/matheiWorker` | **No** — experimental                                     |
| `startCacheWarmerWorker`      | `modules/sites/cacheWarmer`       | Sí                                                        |

---

## Rutas principales

| Ruta           | Archivo                      | Descripción                              |
| -------------- | ---------------------------- | ---------------------------------------- |
| `/auth`        | `routes/authRoutes.js`       | Login, OTP, refresh token                |
| `/users`       | `routes/userRoutes.js`       | CRUD usuarios                            |
| `/companies`   | `routes/companyRoutes.js`    | Empresas y sub_empresas                  |
| `/data`        | `routes/dataRoutes.js`       | Telemetría (lectura de `equipo`)         |
| `/alertas`     | `routes/alertaRoutes.js`     | Alertas y eventos                        |
| `/incidencias` | `routes/incidenciaRoutes.js` | Incidencias                              |
| `/documentos`  | `routes/documentoRoutes.js`  | Documentos adjuntos                      |
| `/health`      | `routes/healthRoutes.js`     | Healthcheck                              |
| `/metrics`     | `routes/metricsRoutes.js`    | Métricas de uso API                      |
| `/status`      | `routes/statusRoutes.js`     | Estado de workers y sistema              |
| `/2fa`         | `routes/twoFactorRoutes.js`  | Two-factor (para acciones sensibles DGA) |
| `/audit-log`   | `routes/auditLogRoutes.js`   | Log de auditoría                         |
| `/internal`    | `routes/internalRoutes.js`   | Endpoints internos (gRPC → API)          |
| `/cold-room`   | `routes/coldRoomRoutes.js`   | Módulo salas frías                       |
| `/catalog`     | `routes/catalogRoutes.js`    | Catálogos de tipos y configuraciones     |

---

## Logging

`pino` con configuración en `config/logger.ts`:

- **Prod:** JSON crudo a stdout
- **Dev/TTY:** `pino-pretty`
- **Redacted:** `authorization`, `cookie`, `*.password`, `*.token`, `*.otp` → `[REDACTED]`
- **Request ID:** inyectado desde `AsyncLocalStorage` en cada log

---

## Variables de entorno clave

```env
PORT=3000
GRPC_PORT=50051
DATABASE_URL=postgresql://postgres:...@emeltec-db:5432/telemetry_platform
JWT_SECRET=...
ENABLE_DGA_SUBMISSION_WORKER=true   # activa envío real a SNIA
DGA_GCS_EMPRESA_ID=CCU              # activa exportación GCS
GOOGLE_APPLICATION_CREDENTIALS=... # path al JSON de SA
DGA_WORKER_POLL_MS=60000            # intervalo fill worker (default 60s)
DGA_WORKER_MAX_SLOTS=24             # slots máximos por pozo por ciclo
ENABLE_DGA_WORKER=true
```

---

## Ver también

- [[dga-pipeline]] — pipeline DGA completo
- [[auth]] — autenticación y permisos
- [[../db/overview]] — base de datos
- [[../grpc-pipeline/csvconsumer]] — quién envía datos por gRPC
