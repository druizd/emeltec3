# Registro de Remediación de Seguridad — Emeltec Cloud

|                           |                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| **Fecha**                 | 14 de junio de 2026                                                                      |
| **Origen**                | Auditoría de ciberseguridad (ver `INFORME-AUDITORIA-SEGURIDAD-2026-06.md`)               |
| **Trazabilidad**          | Rama `druizd/security/audit-remediation` → PR #77 (mergeada a `main`, commit `efc42749`) |
| **Estado del despliegue** | En `main`; deploy pausado a la espera de aprobación manual (gate EMT-H12)                |

Este documento registra, de forma trazable, **qué se corrigió**, **qué queda pendiente** y **qué se aceptó como riesgo controlado**. Cada ítem mantiene su identificador de hallazgo (EMT-xx) del informe.

---

## 1. Hallazgos resueltos (corregidos en código/configuración)

### Control de acceso (críticos)

| ID                   | Hallazgo                                                                                          | Solución aplicada                                                                                                                                                             | Archivos clave                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| EMT-C01              | IDOR en lectura de telemetría (`/api/data/*` v1 y `/api/v2/telemetry/*` v2, este último sin auth) | Autorización por serial centralizada (`canAccessSite` / `resolveAccessibleSerial`) + middlewares; sin serial se devuelve el último equipo del propio usuario, nunca el global | `main-api/src/services/dataAccess.js`, `middlewares/dataSerialAccess.js`, `modules/telemetry/serialAccess.ts`                   |
| EMT-C02              | Bypass de autorización cold-room vía `?siteIds`                                                   | Validación de cada `siteId` de la query contra el alcance del usuario                                                                                                         | `main-api/src/routes/coldRoomRoutes.js`, `middlewares/coldRoomAccess.js`                                                        |
| EMT-C03              | Endpoints sin autenticación / escritura anónima                                                   | `protect` en metrics/domains/devices; `POST /devices` solo Admin; `/api/status` saneado; `getDevices` y `/api/metrics` acotados por tenant                                    | `main-api/src/routes/{catalogRoutes,metricsRoutes}.js`, `controllers/{catalogController,metricsController,statusController}.js` |
| DGA Informantes      | CRUD global de credenciales SNIA por cualquier usuario                                            | Rutas restringidas a `authorizeRoles('SuperAdmin')`                                                                                                                           | `main-api/src/http/v2/routes.ts`                                                                                                |
| IDOR v2 DGA/bitácora | `dga/dato`, `dga/review-queue`, `bitacora/equipos/:id` sin verificación de propiedad              | `assertSiteAccessById` + `authorizeRoles` + lookup de sitio por equipo                                                                                                        | `main-api/src/middlewares/siteAccess.ts`, `modules/dga/controller.ts`, `modules/bitacoraSitio/*`                                |
| EMT-H05              | `sitio_id` no validado al crear alerta/incidencia/documento                                       | `userCanAccessSiteId` antes del insert                                                                                                                                        | `main-api/src/controllers/{alertaController,incidenciaController,documentoController}.js`                                       |
| EMT-H07              | Modelo de acceso divergente / sub-empresa                                                         | Modelo único `canAccessSite` (sub-empresa estricto; sin sub-empresa = toda la empresa) alineado en v1 y v2                                                                    | `dataAccess.js`, `shared/permissions.ts`                                                                                        |

### Autenticación (auth-api)

| ID      | Hallazgo                         | Solución                                                                                   |
| ------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| EMT-H02 | `linux-db-api` fail-open         | Fail-closed (aborta sin `INTERNAL_API_KEY`) + comparación en tiempo constante              |
| EMT-H08 | Lockout trivialmente evadible    | Backoff exponencial (15 min → 4 h), sin recorte; el contador no se resetea al expirar      |
| EMT-H09 | Ventana de OTP muy amplia        | TTL 10/15 min (antes 30 min/24 h)                                                          |
| EMT-H11 | OTP reusable                     | OTP de un solo uso (se invalida en cada intento fallido)                                   |
| EMT-H10 | Enumeración de usuarios          | Respuestas uniformes en `request-code`, `start` y `login`; rate-limit estricto en `/start` |
| (alto)  | `jwt.verify` sin fijar algoritmo | `algorithms: ['HS256']` en tokens de setup y MFA                                           |

### Infraestructura / CI-CD

| ID                | Hallazgo                                | Solución                                                                                         |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| EMT-H03           | Puertos expuestos a `0.0.0.0`           | BD/main-api/auth-api/frontend a `127.0.0.1` en los 3 `docker-compose`                            |
| EMT-H04           | Credenciales hardcodeadas en `infra-db` | Parametrizadas (fail-if-missing); BD y pgAdmin en loopback                                       |
| EMT-H12           | Deploy en push a main sin aprobación    | Gate de _required reviewers_ en environment `production`; un solo deploy automático, sin carrera |
| EMT-C05 (parcial) | Datos DGA versionados                   | Sacado de HEAD + `.gitignore` reforzado (purga de historia pendiente)                            |
| (medio/bajo)      | CORS abierto                            | Allowlist `*.emeltec.cl` + localhost (auth-api y main-api)                                       |
| (medio)           | Contenedores Node como root             | `USER node` en main-api y auth-api                                                               |
| (medio)           | GitHub Actions por tag                  | Fijadas por commit SHA                                                                           |
| (bajo)            | IP falsificable en audit log            | Solo `req.ip` (sin `X-Forwarded-For` crudo)                                                      |
| (bajo)            | Fuga de errores ≠500                    | `errorMiddleware` enmascara todo ≥500 en producción                                              |
| (bajo)            | `vincularIncidencia` sin chequeo        | Valida propiedad de la incidencia                                                                |
| (higiene)         | Archivos indebidos versionados          | Desversionados `node_modules`, `csvprocessor.exe~`, `.dga_res_2170.txt` + `.gitignore`           |

---

## 2. Pendientes

### Acción manual (lo más urgente)

| ID      | Pendiente                                                                                    | Responsable                                 |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| EMT-C04 | **Rotar** secretos filtrados (JWT, DGA, Resend, interna, BD) y **purgar** la historia de Git | Equipo / ops (`RUNBOOK-FASE-0-secretos.md`) |
| EMT-C05 | Purgar el CSV regulatorio de la historia (junto con C04)                                     | Equipo / ops                                |
| EMT-H12 | Aprobar el deploy pausado (o validar `docker build` de imágenes Node antes)                  | Dylan / ops                                 |

### Requiere ventana coordinada (Rust + Go) — `RUNBOOK-FASE-1`

| ID      | Pendiente                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------ |
| EMT-H01 | Autenticación (interceptor/mTLS) + TLS en gRPC (csvconsumer/ftpconsumer + gRPC interno main-api) |
| —       | TLS a PostgreSQL en servicios Rust                                                               |
| —       | Topes anti-DoS en consumidores; errores genéricos; CORS de `linux-db-api`                        |

### Infraestructura

| ID  | Pendiente                                                   |
| --- | ----------------------------------------------------------- |
| B1  | Fijar imágenes Docker por digest (confirmar versión en uso) |
| —   | Contenedores nginx no-root                                  |

---

## 3. Riesgos aceptados / controlados

| Riesgo                      | Estado     | Justificación                                                                                          |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| gRPC de ingesta             | Controlado | Operan en red interna, no expuestos a Internet → mitigado por aislamiento                              |
| DoS de ingesta              | Aceptado   | Limitación de capacidad (RAM/cantidad de equipos), no vector de ataque; se resuelve escalando recursos |
| TLS a BD                    | Controlado | BD en el mismo host; se cifrará en la migración futura a Kubernetes                                    |
| Errores/CORS `linux-db-api` | Aceptado   | Útil en etapa de desarrollo; revisar antes de exposición productiva ampliada                           |

---

## 4. Verificación

- `main-api`: typecheck 0 errores · 91 tests (vitest) · ESLint 0 errores
- `auth-api`: 8 tests (`node:test`) · ESLint 0 errores
- CI de la PR #77: lint/test/build + validación docker-compose **en verde**
- Sin SQL injection; JWT con algoritmo fijado; secretos vía variables de entorno (no hardcodeados)
