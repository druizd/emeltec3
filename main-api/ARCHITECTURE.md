# main-api — Arquitectura

API principal de Emeltec Cloud. Node.js + Express 5 + TypeScript (compilado). Dos interfaces: **HTTP REST** (puerto 3000) y **gRPC** (puerto 50051).

---

## Arranque

```
main-api/migrations/run.js   ← Se ejecuta primero (CMD del Dockerfile)
  └── src/server.js          ← Entry point del proceso Node
        └── src/app.js       ← Express config + rutas legacy (v1, 15 archivos en src/routes/)
        └── dist/http/v2/    ← Rutas TypeScript compiladas (v2)
        └── 14 workers       ← Se inician al levantar HTTP, cada uno desde su build en dist/
```

En producción, el `CMD` del contenedor corre `node migrations/run.js && node dist/server.js`: las migraciones JS numeradas (`main-api/migrations/00N_*.js`) se aplican antes de que el servidor levante — ver [«Migraciones»](#migraciones). `server.js` inicia Express, luego gRPC, luego intenta arrancar cada worker TS desde su build en `dist/` (si falta, solo loguea un warning, salvo el de alertas, que en producción es un error — ver [«Workers en background»](#workers-en-background)). Graceful shutdown en SIGINT/SIGTERM.

Para estructura completa de directorios (`config/`, `shared/`, `middlewares/`, `controllers/`, `grpc/`) ver [`README.md`](./README.md).

---

## Estructura de rutas

### v1 — Legacy CommonJS (`/api/*`)

Montado en `app.js` desde `src/routes/` (15 archivos). `authRoutes.js` existe en ese directorio pero **no** está montado en `app.js` — quedó como código muerto tras la migración de login/OTP a `/api/v2/auth/*`.

| Prefijo                | Router                | Qué hace                                                                                       |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `/api/health`          | `healthRoutes.js`     | health check básico                                                                            |
| `/api/status`          | `statusRoutes.js`     | estado de servicios dependientes                                                               |
| `/api/data`            | `dataRoutes.js`       | telemetría legacy                                                                              |
| `/api` (catálogos)     | `catalogRoutes.js`    | catálogos de referencia                                                                        |
| `/api/metrics`         | `metricsRoutes.js`    | ingestión de métricas de equipo                                                                |
| `/api/internal`        | `internalRoutes.js`   | endpoints service-to-service (ingestores)                                                      |
| `/api/users`           | `userRoutes.js`       | usuarios                                                                                       |
| `/api/companies`       | `companyRoutes.js`    | empresas; monta también contadores/riles/siteOperacionConfig/periodComparison (ver nota abajo) |
| `/api`, `/api/eventos` | `alertaRoutes.js`     | alertas y eventos                                                                              |
| `/api/cold-room`       | `coldRoomRoutes.js`   | monitoreo de cámaras frías (HACCP)                                                             |
| `/api/2fa`             | `twoFactorRoutes.js`  | solicitud/verificación de OTP 2FA                                                              |
| `/api/incidencias`     | `incidenciaRoutes.js` | incidencias de sitio                                                                           |
| `/api/documentos`      | `documentoRoutes.js`  | documentos (bitácora, blob Azure)                                                              |
| `/api/audit-log`       | `auditLogRoutes.js`   | log de auditoría Ley 21.663                                                                    |

> `contadores`, `riles`, `siteOperacionConfig` y `periodComparison` son módulos TypeScript sin router propio en `http/v2/routes.ts`: sus controllers se compilan a `dist/` y `companyRoutes.js` los `require()` de forma perezosa (try/catch), montados bajo `/api/companies/sites/:siteId/*`. Si `dist/` no existe (dev sin build) esas rutas simplemente no se registran.

### v2 — TypeScript (`/api/v2/*`)

#### Telemetría (requiere JWT + autorización de serial)

| Método | Ruta                | Qué hace                                     |
| ------ | ------------------- | -------------------------------------------- |
| GET    | `/telemetry`        | Histórico por serial, keys, rango de fechas  |
| GET    | `/telemetry/latest` | Último valor por serial                      |
| GET    | `/telemetry/online` | Seriales online ahora                        |
| GET    | `/telemetry/preset` | Ventanas predefinidas (24h/7d/30d/365d)      |
| GET    | `/telemetry/keys`   | Keys de un serial; `sitio_id` acota a 1 obra |

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

#### DGA — Pozo Config (JWT + 2FA si transport=rest o dga_gcs_export)

| Método | Ruta                          | Qué hace                                       |
| ------ | ----------------------------- | ---------------------------------------------- |
| GET    | `/dga/sites/:id/pozo-config`  | Config DGA del pozo                            |
| PATCH  | `/dga/sites/:id/pozo-config`  | Actualizar config (2FA si cambia lo sensible)  |
| GET    | `/dga/sites/:id/live-preview` | Último dato validado listo para envío          |
| GET    | `/dga/sites/:id/ultimo-envio` | Último envío exitoso a SNIA                    |
| GET    | `/dga/sites/:id/verify`       | Verificación de conectividad/credenciales SNIA |

#### DGA — Mediciones (JWT)

| Método | Ruta                      | Qué hace                       |
| ------ | ------------------------- | ------------------------------ |
| GET    | `/dga/dato`               | Consultar mediciones por sitio |
| GET    | `/dga/dato/export.csv`    | CSV de dato_dga                |
| GET    | `/dga/export-directo.csv` | CSV directo del equipo         |

#### DGA — Cola de revisión y acciones en bloque (JWT, Admin/SuperAdmin, 2FA obligatorio)

El OTP se pide vía `POST /api/2fa/request` (ruta v1 unificada, `twoFactorRoutes.js` + `shared/email-otp`), no bajo `/dga/*`; todas las mutaciones sensibles (DGA incluido) lo validan con el header `X-2FA-Code`.

| Método | Ruta                                         | Qué hace                                                                 |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/dga/review-queue`                          | Slots pendientes de revisión admin                                       |
| POST   | `/dga/review-queue/action`                   | Aceptar/descartar un slot                                                |
| POST   | `/dga/review-queue/bulk`                     | Misma acción sobre varios slots sueltos, un solo OTP + auditoría         |
| GET    | `/dga/sites/:id/slots/resumen`               | Resumen por estado de un rango de slots (previa a la acción)             |
| POST   | `/dga/sites/:id/slots/bulk`                  | Recalcular o dar de baja un rango de slots (nunca toca enviado/enviando) |
| POST   | `/dga/sites/:id/reconocer-sensor-defectuoso` | Marca `reg_map` + incidencia y acepta el backlog acumulado               |

#### Bitácora Sitio (JWT)

| Método | Ruta                                      | Qué hace                            |
| ------ | ----------------------------------------- | ----------------------------------- |
| GET    | `/sites/:id/bitacora/ficha`               | Ficha técnica del sitio             |
| PATCH  | `/sites/:id/bitacora/ficha`               | Actualizar ficha                    |
| POST   | `/sites/:id/bitacora/contacto`            | Crear contacto operativo (2FA, PII) |
| POST   | `/sites/:id/bitacora/contacto/:id/reveal` | Revelar contacto (2FA, auditado)    |
| PATCH  | `/sites/:id/bitacora/contacto/:id`        | Actualizar contacto (2FA)           |
| DELETE | `/sites/:id/bitacora/contacto/:id`        | Eliminar contacto (2FA)             |
| GET    | `/sites/:id/bitacora/equipos`             | Lista equipos                       |
| POST   | `/sites/:id/bitacora/equipos`             | Agregar equipo                      |
| PATCH  | `/sites/bitacora/equipos/:id`             | Actualizar equipo                   |
| DELETE | `/sites/bitacora/equipos/:id`             | Eliminar equipo                     |

#### PII — reveal (JWT + 2FA obligatorio, auditado)

| Método | Ruta                             | Qué hace                                          |
| ------ | -------------------------------- | ------------------------------------------------- |
| POST   | `/companies/contacts/:id/reveal` | Revela un contacto operativo (agenda) enmascarado |
| POST   | `/users/:id/reveal`              | Revela el teléfono de un usuario enmascarado      |

#### Health Digest — configuración (JWT, solo SuperAdmin)

Config del equipo Emeltec (destinatarios y horarios del resumen de salud), no de un tenant. Mutaciones auditadas (Ley 21.663 §32).

| Método | Ruta                           | Qué hace                                                    |
| ------ | ------------------------------ | ----------------------------------------------------------- |
| GET    | `/health-digest/destinatarios` | Lista destinatarios del resumen                             |
| PUT    | `/health-digest/destinatarios` | Reemplaza la lista (2FA solo si agrega una dirección nueva) |
| PUT    | `/health-digest/config`        | Horas de envío y umbral de horas sin transmitir (sin 2FA)   |
| POST   | `/health-digest/prueba`        | Envía un resumen de prueba                                  |

#### Análisis (JWT)

| Método | Ruta                           | Qué hace               |
| ------ | ------------------------------ | ---------------------- |
| GET    | `/sites/:id/analisis/salud`    | Health score del sitio |
| GET    | `/sites/:id/analisis/metricas` | Resumen de métricas    |

---

## Módulos (`src/modules/`)

21 bounded contexts TypeScript. Cada uno sigue `{repo,service,controller,schema}.ts`; los controllers no importan repos directamente, solo services.

| Módulo                | Responsabilidad                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `alerts`              | Worker de evaluación de alertas y notificaciones — reemplaza al legado `services/alertaService.js`                   |
| `analisis`            | Health score y resumen de métricas por sitio                                                                         |
| `arco`                | Exportación de datos y aceptación de política ARCO/privacidad; sin ruta propia, usado desde `userController.js`      |
| `auth`                | Login JWT + solicitud de OTP por email                                                                               |
| `bitacoraSitio`       | Ficha técnica + inventario de equipos por sitio                                                                      |
| `companies`           | Árbol jerárquico empresa → sub_empresa → sitio                                                                       |
| `contactos`           | Reveal de contactos operativos (PII, con 2FA)                                                                        |
| `contadores`          | Agregación mensual y diaria de contadores (energía, volumen); controller montado desde `dist/` en `companyRoutes.js` |
| `dga`                 | Pipeline DGA completo: pool de informantes, slots `dato_dga`, envío SNIA, cola de revisión, exportador GCS, 2FA      |
| `health`              | Liveness, readiness, `/metrics` Prometheus                                                                           |
| `healthDigest`        | Resumen de salud de transmisión + DGA, y destinatarios internos                                                      |
| `metrics`             | Buffer in-memory de `api_metrics` → flush a DB cada 5 s                                                              |
| `periodComparison`    | Comparación de períodos A/B por sub-empresa/empresa; controller montado desde `dist/` en `companyRoutes.js`          |
| `retention`           | Retención de datos (ARCO) y alertas de auditoría (Ley 21.663)                                                        |
| `riles`               | Config, fuentes, balance y laboratorio de RILes; controller montado desde `dist/` en `companyRoutes.js`              |
| `simulation`          | Worker de simulación Mathei (pasteurizador real → variables virtuales)                                               |
| `siteOperacionConfig` | Config de turnos de operación por sitio; controller montado desde `dist/` en `companyRoutes.js`                      |
| `sites`               | Metadata de sitios, dashboard data/history, cache warmer                                                             |
| `telemetry`           | Consultas de timeseries: histórico, latest, online, preset, keys                                                     |
| `usuarios`            | Reveal del teléfono de usuario (PII, con 2FA)                                                                        |
| `weeklyDigest`        | Resumen semanal de alertas abiertas, al cliente                                                                      |

---

## Workers en background

`server.js` intenta arrancar 14 workers al levantar el HTTP server, cada uno cargando su build de `dist/modules/<módulo>/...`. Si el build falta, el worker no arranca y solo se loguea un warning — excepto el de alertas, que en producción es un error. La mayoría tiene su propio kill switch `ENABLE_*` (ver `.env.example` / `main-api/README.md`).

| Worker                   | Switch                                                                     | Qué hace                                                                                             |
| ------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Alerts worker            | siempre activo                                                             | Evalúa reglas de alertas y dispara notificaciones (reemplaza `alertaService.js`)                     |
| Metrics flusher          | siempre activo                                                             | Vacía el buffer in-memory de `api_metrics` a DB cada 5 s                                             |
| DGA worker               | `ENABLE_DGA_WORKER`                                                        | Llena slots `vacio` → `pendiente` con datos del equipo                                               |
| DGA preseed              | `ENABLE_DGA_PRESEED_WORKER`                                                | Crea slots `vacio` del mes/mes siguiente                                                             |
| DGA submission           | `ENABLE_DGA_SUBMISSION_WORKER` (OFF por defecto)                           | Envía slots `pendiente` a SNIA                                                                       |
| DGA GCS exporter         | `ENABLE_DGA_GCS_WORKER` (OFF por defecto)                                  | Sube envíos DGA respondidos a Google Cloud Storage                                                   |
| DGA reconciler           | `ENABLE_DGA_RECONCILER`                                                    | Red de seguridad: detecta drift y slots atascados                                                    |
| Health digest            | `ENABLE_HEALTH_DIGEST_WORKER` (OFF por defecto)                            | Resumen de salud de transmisión + DGA                                                                |
| Weekly digest            | `ENABLE_WEEKLY_DIGEST_WORKER`                                              | Resumen semanal de alertas abiertas al cliente                                                       |
| Contadores worker        | `ENABLE_CONTADORES_WORKER`                                                 | Agrega contadores mensuales                                                                          |
| Contadores daily worker  | `ENABLE_CONTADORES_DAILY_WORKER` (OFF por defecto)                         | Materializa `site_contador_diario`/jornada                                                           |
| Mathei simulation worker | `ENABLE_MATHEI_SIMULATION_WORKER` (OFF por defecto)                        | Deriva variables virtuales desde el pasteurizador real                                               |
| Retention worker         | `ENABLE_RETENTION_WORKER` / `ENABLE_AUDIT_ALERTS_WORKER` (OFF por defecto) | Retención ARCO y alertas de auditoría Ley 21.663 — dos switches independientes sobre el mismo worker |
| Cache warmer             | `ENABLE_CACHE_WARMER_WORKER`                                               | Precalienta `dashboard-history` en Redis cada ~50 s                                                  |

> Nota de código: en `server.js`, el bloque de arranque del DGA GCS exporter se ejecuta dos veces contra el mismo módulo (`dist/modules/dga/gcs-exporter`); el primer intento llama una función que el módulo no exporta (`startDgaGcsExporter`) y falla en silencio (warning en log), y el segundo, que sí llama a `startDgaGcsExporterWorker`, es el que efectivamente inicia el worker. El comportamiento en producción no cambia, pero el log de arranque muestra un warning inofensivo de más.

> `healthDigest` (resumen de salud de transmisión) y `auditAlerts` (alertas de auditoría Ley 21.663, dentro del módulo `retention`) son switches independientes — no asumir que uno implica el estado del otro al verificar si un correo debería estar saliendo.

---

## Base de datos

**TimescaleDB** (PostgreSQL 16 + extensión timescaledb). Docker container: `emeltec-db`.

| Tabla                   | Tipo                   | Descripción                                                                                                                      |
| ----------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `sitio`                 | normal                 | Instalaciones/pozos                                                                                                              |
| `equipo`                | hypertable             | Telemetría timeseries (time, id_serial, data JSONB)                                                                              |
| `pozo_config`           | normal                 | Config DGA por sitio; incluye la ficha técnica de bitácora como JSONB (`ficha_critica`: pin, contactos, acreditaciones, riesgos) |
| `reg_map`               | normal                 | Mapeo variables: alias, unidad, rol_dashboard, con vigencia temporal por ventana                                                 |
| `dato_dga`              | normal PK(sitio_id,ts) | Mediciones DGA con estado del slot                                                                                               |
| `dga_informante`        | normal                 | Pool global de informantes (clave cifrada AES-256)                                                                               |
| `dga_send_audit`        | normal                 | Log de envíos a SNIA                                                                                                             |
| `usuario`               | normal                 | Usuarios con roles                                                                                                               |
| `empresa`               | normal                 | Empresas cliente                                                                                                                 |
| `sub_empresa`           | normal                 | Sub-empresas                                                                                                                     |
| `sitio_equipo`          | normal                 | Inventario de equipamiento físico por sitio (bitácora)                                                                           |
| `contacto_operativo`    | normal                 | Contactos operativos por sitio (PII, reveal con 2FA)                                                                             |
| `site_contador_mensual` | normal                 | Contadores mensuales                                                                                                             |
| `site_contador_diario`  | normal                 | Contadores diarios/jornada (materializados por el worker diario)                                                                 |
| `audit_log`             | normal                 | Log de mutaciones Ley 21.663 §32                                                                                                 |

### Ciclo de vida slot DGA

```
vacio  →  pendiente  →  aceptado
                    ↘  requires_review  →  aceptado / rechazado
```

### Migraciones

Dos sistemas independientes, sin relación entre sí:

- **SQL** (`infra-db/migrations/*.sql`, convención `YYYY-MM-DD-nombre.sql`): las aplica `scripts/deploy-production.sh` contra la VM en cada deploy, antes de levantar los servicios (ver [`docs/deployment.md`](../docs/deployment.md)). Son idempotentes (`IF NOT EXISTS`, `DO $$ ... $$`), pero un `CREATE TABLE IF NOT EXISTS` no agrega columnas a una tabla ya existente: una migración que solo cambia estructura de una tabla previa necesita su propio `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **JS numeradas** (`main-api/migrations/00N_*.js` + `run.js`): se ejecutan automáticamente al iniciar el contenedor de `main-api`, antes que el servidor (`CMD ["sh", "-c", "node migrations/run.js && node dist/server.js"]` en el `Dockerfile`), con advisory lock de Postgres y tabla `schema_migrations` para no repetirlas. Si una falla, el contenedor no levanta el server. A diferencia de las SQL, **no** las aplica CI: no hay compuerta que las valide contra una base vacía antes del deploy.

El schema base real es `infra-db/init-db/01-init-schema.sql`, aplicado por Docker solo al crear el volumen de la BD por primera vez. `main-api/sql/init.sql` está **obsoleto** (el propio archivo se marca `DEPRECATED`) — no usarlo como referencia de schema.

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

**2FA vía OTP email** (Resend API), unificado en `POST /api/2fa/request` — requerido en:

- Cambio de `clave_informante` DGA, y siempre al eliminar un informante
- Config `dga_transport = rest` o `dga_gcs_export = true`
- Toda acción de la cola de revisión DGA (individual y en bloque) y las acciones en bloque sobre un rango de slots
- Reconocer sensor defectuoso
- Reveal de PII (contactos operativos, teléfono de usuario)
- Agregar un destinatario nuevo al health digest (no al editar/quitar uno existente)

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

Lista completa por área (servidor, DB, Redis, DGA, contadores, retención, etc.) en [`README.md`](./README.md). Acá solo las más relevantes para entender la arquitectura:

| Variable                          | Requerida | Default      | Qué hace                                                         |
| --------------------------------- | --------- | ------------ | ---------------------------------------------------------------- |
| `JWT_SECRET`                      | ✅        | —            | Firma JWT (min 16 chars)                                         |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | ✅        | —            | PostgreSQL                                                       |
| `DGA_ENCRYPTION_KEY`              | ✅ (DGA)  | —            | AES-256 para claves informantes                                  |
| `RESEND_API_KEY`                  | ✅ (2FA)  | —            | Email OTP                                                        |
| `MONITOR_PRIMARY_EMAIL`           | ❌        | —            | Buzón de respaldo si no hay destinatarios de health digest       |
| `REDIS_URL`                       | ❌        | noop         | Cache + rate limit                                               |
| `AZURE_STORAGE_CONNECTION_STRING` | ❌        | 503 si falta | Documentos blob                                                  |
| `ENABLE_DGA_SUBMISSION_WORKER`    | ❌        | `false`      | Activar envío real a SNIA                                        |
| `CORS_ORIGIN`                     | ❌        | `*`          | Whitelist CORS (falla el arranque en producción si queda en `*`) |

> `DGA_RUT_EMPRESA` ya no es variable de entorno: quedó hardcodeado en `src/config/appConfig.ts` por ser información pública (SII), no un secreto.

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
