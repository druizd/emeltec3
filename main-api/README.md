# 🖥️ main-api — Backend REST API

Servidor backend construido con **Node.js + Express 5 + TypeScript** que maneja toda la lógica de negocio: autenticación, gestión de empresas/sitios, telemetría, DGA, contadores, riles, alertas, bitácora y correo.

> Estado: refactor en curso de CommonJS a TypeScript + módulos. Endpoints `/api/*` (v1, legacy) siguen vivos para compatibilidad; los módulos nuevos viven bajo `src/modules/<bounded-context>/{repo,service,controller,schema}.ts` y se exponen tanto en `/api/v2/*` (router TypeScript) como, para algunos módulos, montados directamente dentro de rutas v1 (ver más abajo).
>
> Para el detalle de endpoints v2 por sección, módulos, workers, roles y el ciclo de vida de un slot DGA, ver **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — este README cubre estructura, cómo levantar el proyecto y variables de entorno.

## 🏗️ Arquitectura

```
src/
├── config/        appConfig.ts (zod — fuente de verdad para los módulos TS nuevos),
│                  env.js (CJS legacy, usado por app.js/routes v1), db.js/db.ts,
│                  logger.ts (pino), metrics.ts (prom-client registry)
├── shared/        errors.ts, httpEnvelope.ts (ok/paginated/err), permissions.ts,
│                  time.ts, pagination.ts, requestContext.ts
├── middlewares/   auth.ts / authMiddleware.js (JWT), error.ts, requestId.ts, httpMetrics.ts
├── http/v2/       routes.ts — router TypeScript montado en /api/v2 desde app.js
├── controllers/   13 controllers CJS legacy (v1) — ver tabla de rutas abajo
├── routes/        15 archivos de rutas CJS legacy (v1)
├── modules/       21 bounded contexts TS (ver tabla abajo)
├── grpc/          servidor gRPC (puerto 50051) para el pipeline Go
└── server.js / app.js   entry point y config de Express (montan v1 + v2 + arrancan workers + gRPC)
```

**Reglas:** controllers no importan repos directamente — sólo services. Repos sólo consultan DB. Schemas zod son la fuente de verdad para validación + tipos derivados en los módulos TS.

### Módulos (`src/modules/`)

| Módulo                | Propósito                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `alerts`              | Worker de evaluación de alertas (reemplaza el legado `alertaService.js`)                                           |
| `analisis`            | Health score y métricas resumen por sitio                                                                          |
| `arco`                | Exportación de datos y aceptación de política ARCO/privacidad (usado por `userController.js`, sin ruta propia)     |
| `auth`                | Login JWT + OTP por email                                                                                          |
| `bitacoraSitio`       | Ficha técnica + inventario de equipos + contactos operativos por sitio                                             |
| `companies`           | Árbol jerárquico empresa → sub-empresa → sitio                                                                     |
| `contactos`           | Reveal de contactos operativos (PII, con 2FA)                                                                      |
| `contadores`          | Agregación mensual/diaria de contadores (energía, volumen); controller montado desde `dist/` en `companyRoutes.js` |
| `dga`                 | Pipeline DGA completo: informantes, pozo-config, slots `dato_dga`, envío SNIA, cola de revisión, exportador GCS    |
| `health`              | Liveness, readiness, `/metrics` Prometheus                                                                         |
| `healthDigest`        | Resumen de salud de transmisión + destinatarios internos                                                           |
| `metrics`             | Buffer in-memory de `api_metrics` + flusher batch cada 5 s                                                         |
| `periodComparison`    | Comparación de períodos A/B por sub-empresa/empresa; controller montado desde `dist/` en `companyRoutes.js`        |
| `retention`           | Retención de datos (ARCO) y alertas de auditoría (Ley 21.663)                                                      |
| `riles`               | Config, fuentes, balance y laboratorio de RILes; controller montado desde `dist/` en `companyRoutes.js`            |
| `simulation`          | Worker de simulación Mathei (pasteurizador real → variables virtuales)                                             |
| `siteOperacionConfig` | Config de turnos de operación por sitio; controller montado desde `dist/` en `companyRoutes.js`                    |
| `sites`               | Metadata de sitios, dashboard data/history, cache warmer                                                           |
| `telemetry`           | Consultas de timeseries: histórico, latest, online, preset, keys                                                   |
| `usuarios`            | Reveal de teléfono de usuario (PII, con 2FA)                                                                       |
| `weeklyDigest`        | Resumen semanal de alertas abiertas al cliente                                                                     |

> Nota de arquitectura: `contadores`, `riles`, `siteOperacionConfig` y `periodComparison` son módulos TypeScript sin ruta en `http/v2/routes.ts`; sus controllers se compilan a `dist/` y se `require()` de forma perezosa desde `src/routes/companyRoutes.js` (CJS), montados bajo `/api/companies/sites/:siteId/*`. Si `dist/` no existe (dev sin build) esas rutas simplemente no se registran.

## 🌐 Rutas — prefijos

### v1 — legacy CJS, montado en `app.js`

| Prefijo                  | Router                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `/api/health`            | `healthRoutes.js`                                                                                   |
| `/api/status`            | `statusRoutes.js`                                                                                   |
| `/api/data`              | `dataRoutes.js`                                                                                     |
| `/api` (catálogos)       | `catalogRoutes.js`                                                                                  |
| `/api/metrics`           | `metricsRoutes.js`                                                                                  |
| `/api/internal`          | `internalRoutes.js`                                                                                 |
| `/api/users`             | `userRoutes.js`                                                                                     |
| `/api/companies`         | `companyRoutes.js` (incluye contadores/riles/siteOperacionConfig/periodComparison, ver nota arriba) |
| `/api` (alertas/eventos) | `alertaRoutes.js`                                                                                   |
| `/api/cold-room`         | `coldRoomRoutes.js`                                                                                 |
| `/api/2fa`               | `twoFactorRoutes.js`                                                                                |
| `/api/incidencias`       | `incidenciaRoutes.js`                                                                               |
| `/api/documentos`        | `documentoRoutes.js`                                                                                |
| `/api/audit-log`         | `auditLogRoutes.js`                                                                                 |

### v2 — TypeScript, montado en `/api/v2` desde `http/v2/routes.ts`

| Prefijo                                               | Contenido                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/health/live`, `/health/ready`, `/metrics`           | liveness, readiness, Prometheus                                                                         |
| `/telemetry*`                                         | histórico, latest, online, preset, keys (JWT + acceso por serial)                                       |
| `/sites/:siteId/dashboard-*`                          | dashboard data/history                                                                                  |
| `/companies/tree`                                     | árbol jerárquico                                                                                        |
| `/auth/login`, `/auth/request-code`                   | login + OTP                                                                                             |
| `/dga/informantes*`                                   | pool global de credenciales SNIA (solo SuperAdmin)                                                      |
| `/dga/sites/:siteId/*`                                | pozo-config, live-preview, ultimo-envio, verify, slots/resumen, slots/bulk, reconocer-sensor-defectuoso |
| `/dga/dato*`, `/dga/export-directo.csv`               | consulta y exportación de mediciones DGA                                                                |
| `/dga/review-queue*`                                  | cola de revisión (Admin/SuperAdmin, 2FA)                                                                |
| `/companies/contacts/:id/reveal`, `/users/:id/reveal` | reveal de PII (2FA)                                                                                     |
| `/sites/:siteId/analisis/*`                           | salud, métricas                                                                                         |
| `/sites/:siteId/bitacora/*`                           | ficha, contactos, equipos                                                                               |
| `/health-digest/*`                                    | destinatarios, config, envío de prueba (solo SuperAdmin)                                                |

Detalle método-por-método (con roles y notas de 2FA) en [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## ⚙️ Workers en background

Todos arrancan desde `server.js` al levantar el HTTP server, cargando su build de `dist/` (si falta, el worker no arranca y solo se loguea un warning — excepto el de alertas, que en producción es un error). La mayoría tiene su propio kill switch `ENABLE_*` (ver env vars).

| Worker                   | Qué hace                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| Metrics flusher          | Vacía el buffer in-memory de `api_metrics` a DB cada 5 s                 |
| Alerts worker            | Evalúa reglas de alertas y dispara notificaciones                        |
| DGA worker               | Llena slots `vacio` → `pendiente` con datos del equipo                   |
| DGA preseed              | Crea slots `vacio` del mes/mes siguiente                                 |
| DGA submission           | Envía slots `pendiente` a SNIA (OFF por defecto)                         |
| DGA GCS exporter         | Sube envíos DGA respondidos a Google Cloud Storage (OFF por defecto)     |
| DGA reconciler           | Red de seguridad: detecta drift y slots atascados                        |
| Health digest            | Resumen de salud de transmisión + DGA (OFF por defecto)                  |
| Weekly digest            | Resumen semanal de alertas al cliente                                    |
| Contadores worker        | Agrega contadores mensuales                                              |
| Contadores daily worker  | Materializa `site_contador_diario`/jornada (OFF por defecto)             |
| Mathei simulation worker | Deriva variables virtuales desde el pasteurizador real (OFF por defecto) |
| Retention worker         | Retención ARCO + alertas de auditoría Ley 21.663 (OFF por defecto)       |
| Cache warmer             | Precalienta `dashboard-history` en Redis cada ~50 s                      |

## 🚀 Cómo arrancar

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de variables de entorno
cp .env.example .env
# Edita .env con tus credenciales reales de BD, Redis, etc.

# 3. Sembrar usuarios/equipos iniciales (solo la primera vez, según el caso)
node src/seed_auth.js       # usuarios de prueba
node src/seed_devices.js    # equipos de prueba
node src/seed_full.js       # seed completo

# 4. Iniciar el servidor (auto-reload con --watch)
npm run dev

# O compilar y correr como en producción:
npm run build
npm start
```

El servidor HTTP queda en `http://localhost:3000`; el servidor gRPC en el puerto `GRPC_PORT` (default `50051`).

### Scripts (`package.json`)

| Script                | Qué hace                                        |
| --------------------- | ----------------------------------------------- |
| `dev`                 | `node --watch src/server.js`                    |
| `build`               | limpia `dist/` y compila TypeScript (`tsc`)     |
| `start`               | `node dist/server.js` (requiere `build` previo) |
| `typecheck`           | `tsc --noEmit` con `tsconfig.test.json`         |
| `lint` / `lint:fix`   | ESLint sobre `src`                              |
| `test` / `test:watch` | Vitest                                          |

## 🗄️ Base de datos y migraciones

- **Schema base**: `infra-db/init-db/01-init-schema.sql` es la fuente real, aplicada por Docker al crear el volumen de la BD por primera vez.
- ⚠️ `main-api/sql/init.sql` está **obsoleto** (el propio archivo se marca `DEPRECATED`) — no lo uses como referencia de schema.
- **Migraciones SQL** (`infra-db/migrations/*.sql`, convención `YYYY-MM-DD-nombre.sql`): las aplica `scripts/deploy-production.sh` contra la VM en cada deploy, antes de levantar los servicios. Ver [`docs/deployment.md`](../docs/deployment.md).
- **Migraciones JS numeradas** (`main-api/migrations/00N_*.js` + `run.js`): se ejecutan automáticamente al arrancar el contenedor de `main-api` (`CMD ["sh", "-c", "node migrations/run.js && node dist/server.js"]` en el `Dockerfile`), con advisory lock de Postgres y tabla `schema_migrations` para no repetirlas. Si una falla, el contenedor no levanta el server.

## 🔑 Variables de entorno

Nombres únicamente — ver `.env.example` para el detalle y `src/config/appConfig.ts` (zod, módulos TS) / `src/config/env.js` (legacy) para el código fuente de verdad.

**Servidor / core**: `NODE_ENV`, `PORT`, `GRPC_PORT`, `CORS_ORIGIN`, `TRUST_PROXY_HOPS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `LOG_LEVEL`

**Base de datos**: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONN_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_SLOW_LOG_MS`

**Redis** (opcional, degrada a noop si falta): `REDIS_URL`, `REDIS_KEY_PREFIX`

**Auth / seguridad**: `JWT_SECRET`, `INTERNAL_API_KEY`

**Correo (Resend)**: `RESEND_API_KEY`, `RESEND_FROM`, `FRONTEND_URL`, `EMAIL_LOGO_PATH`

**Alertas**: `ALERT_EMELTEC_EMAILS`, `ALERT_POLL_MS`, `ALERT_TIMEZONE`, `ALERT_CONSUMO_CACHE_MS`

**DGA**: `DGA_ENCRYPTION_KEY`, `DGA_API_URL`, `ENABLE_DGA_WORKER`, `DGA_WORKER_POLL_MS`, `DGA_WORKER_MAX_SLOTS`, `DGA_STALE_SLOT_HOURS`, `DGA_NO_DATA_WARN_HOURS`, `ENABLE_DGA_PRESEED_WORKER`, `DGA_PRESEED_POLL_MS`, `ENABLE_DGA_SUBMISSION_WORKER`, `DGA_SUBMISSION_POLL_MS`, `DGA_SUBMISSION_MAX_PER_CYCLE`, `DGA_SUBMISSION_DELAY_MS`, `ENABLE_DGA_RECONCILER`, `DGA_RECONCILER_POLL_MS`, `DGA_RECONCILER_STUCK_MIN`, `DGA_RECONCILER_STALE_VACIO_HOURS`, `DGA_DIGEST_HOURS`, `DGA_NO_DATA_GIVEUP_DAYS`, `ENABLE_DGA_GCS_WORKER`, `DGA_GCS_BUCKET`, `DGA_GCS_BATCH_MINUTES`, `DGA_GCS_MAX_PER_CYCLE`, `DGA_GCS_KEY_FILE`, `DGA_GCS_PROVEEDOR`

> `DGA_RUT_EMPRESA` ya **no** es variable de entorno: quedó hardcodeado en `appConfig.ts` (`rutEmpresa`) — es información pública (SII), no un secreto.

**Health / weekly digest**: `ENABLE_HEALTH_DIGEST_WORKER`, `HEALTH_DIGEST_POLL_MS`, `MONITOR_PRIMARY_EMAIL`, `ENABLE_WEEKLY_DIGEST_WORKER`, `WEEKLY_DIGEST_POLL_MS`

**Contadores**: `ENABLE_CONTADORES_WORKER`, `CONTADORES_WORKER_POLL_MS`, `CONTADORES_WORKER_MESES`, `CONTADORES_MONTH_QUERY_TIMEOUT_MS`, `ENABLE_CONTADORES_DAILY_WORKER`, `CONTADORES_DAILY_WORKER_POLL_MS`, `CONTADORES_DAILY_WORKER_DIAS`

**Retención / auditoría (Ley 21.663)**: `ENABLE_RETENTION_WORKER`, `RETENTION_AUDIT_MONTHS`, `RETENTION_DGA_MONTHS`, `RETENTION_INACTIVITY_MONTHS`, `RETENTION_NOTICE_DAYS`, `RETENTION_POLL_MS`, `ENABLE_AUDIT_ALERTS_WORKER`, `AUDIT_ALERT_LOGIN_WINDOW_MINUTES`, `AUDIT_ALERT_LOGIN_THRESHOLD`, `AUDIT_ALERT_COOLDOWN_MINUTES`, `AUDIT_ALERTS_POLL_MS`

**Otros**: `ENABLE_CACHE_WARMER_WORKER`, `SESSION_REVOCATION_TTL_MS`, `DOCUMENTOS_MAX_MB`, `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_SAS_TTL_MIN`, `CSVCONSUMER_HOST`, `CSVCONSUMER_PORT`, `FTPCONSUMER_HOST`, `FTPCONSUMER_PORT`, `AUTH_API_URL`, `LINUX_DB_API_URL`, `INGESTION_FRESH_MS`, `WORKER_STALE_MS`

## 🔒 Seguridad

- **bcrypt** (10 salt rounds) para hashear contraseñas y códigos OTP.
- **JWT** HS256, expiración 12 h (`jwt.sign(..., { expiresIn: '12h' })`).
- **Helmet** para cabeceras HTTP.
- **Rate limiting** global configurable (`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`; `0` en cualquiera de los dos lo deshabilita).
- **CORS** fail-closed: solo subdominios de `emeltec.cl`, `localhost`/`127.0.0.1`, y orígenes extra en `CORS_ORIGIN`. No hay `*` por defecto en producción (falla el arranque si `NODE_ENV=production` y `CORS_ORIGIN=*`).
- Middleware de **autorización por roles** (`protect` + `authorizeRoles`) y de **acceso por sitio/serial** (IDOR guards).
- **2FA por OTP de correo** en mutaciones sensibles (informantes DGA, cola de revisión, reveal de PII).
- **Bitácora de auditoría** (Ley 21.663 §32) sobre mutaciones en `/api/users`, `/api/companies`, `/api/alertas`, `/api/eventos` y las rutas DGA sensibles.
