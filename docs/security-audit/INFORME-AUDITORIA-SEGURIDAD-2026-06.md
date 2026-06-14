# Informe de Auditoría de Ciberseguridad — Plataforma Emeltec

| | |
|---|---|
| **Objeto auditado** | Plataforma Emeltec (monorepo `emeltec3`) — plataforma IIoT y cumplimiento DGA |
| **Commit auditado** | `c44767d` (rama `main`) |
| **Fecha de auditoría** | 13 de junio de 2026 |
| **Última actualización** | 14 de junio de 2026 — Rev. 3: re-auditoría + remediación capa v2 (ver §1bis) |
| **Tipo de auditoría** | Revisión de seguridad de aplicación (SAST manual), dependencias / supply-chain, infraestructura y configuración, y mapeo de cumplimiento OWASP |
| **Alcance** | Plataforma completa: 11 servicios + infraestructura |
| **Metodología** | Revisión manual de código fuente, análisis de configuración, inspección de historia de Git, verificación adversaria de hallazgos críticos |
| **Clasificación del documento** | Confidencial — uso interno y para la parte que solicita la auditoría |

---

## 1. Resumen ejecutivo

Se auditó la totalidad de la plataforma Emeltec, una solución IIoT multi-servicio para monitoreo industrial y cumplimiento regulatorio ante la Dirección General de Aguas (DGA). La plataforma está compuesta por once servicios (dos APIs Node.js/Express, tres servicios Rust de ingesta/acceso a datos, un frontend Angular, dos sitios estáticos, base de datos TimescaleDB, Redis y Nginx) desplegados con Docker Compose sobre una VM Linux.

El estado general de seguridad presenta **fundamentos sólidos en varias áreas** (consultas parametrizadas en todos los servicios, hashing de contraseñas con bcrypt, verificación de JWT con algoritmo fijado, comparación timing-safe de la clave interna, headers de seguridad fuertes en el contenedor del frontend), pero también **deficiencias críticas de control de acceso multi-tenant y de gestión de secretos** que deben remediarse antes de considerar la plataforma apta para producción regulada.

### Hallazgos por severidad

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítica | 5 |
| 🟠 Alta | 12 |
| 🟡 Media | 13 |
| 🔵 Baja / Informativa | 10 |
| **Total** | **40** |

### Los cinco riesgos críticos (acción inmediata)

1. **EMT-C01 — Acceso a datos entre clientes (IDOR) en `/api/data/*`**: cualquier usuario autenticado, incluso del rol más bajo, puede leer la telemetría de **cualquier** dispositivo de **cualquier** empresa pasando un `serial_id` arbitrario. No existe ningún control de propiedad. *Verificado contra el código.*
2. **EMT-C02 — Bypass de autorización en cold-room vía `?siteIds`**: el middleware valida solo el `:siteId` de la ruta, pero los handlers consultan la lista `?siteIds` provista por el atacante. *Verificado.*
3. **EMT-C03 — Endpoints sin autenticación con escritura anónima**: `POST /api/devices` permite crear/sobrescribir el catálogo de dispositivos sin token; `/api/status`, `/api/metrics`, `/api/domains` exponen información interna. *Verificado.*
4. **EMT-C04 — Secretos productivos en la historia de Git**: la clave de firma JWT, la clave de cifrado DGA (`DGA_ENCRYPTION_KEY`), la API key de Resend y la `INTERNAL_API_KEY` están en commits accesibles desde `origin/main`. Cualquiera con acceso al repositorio puede forjar tokens de sesión y suplantar a cualquier usuario. *Verificado contra la historia de Git.*
5. **EMT-C05 — Datos regulatorios reales de la DGA versionados**: el archivo `historico_dga_OB-0601-292.csv` (18.588 filas reales + 13.702 tokens de comprobante DGA) está commiteado y persiste en la historia. *Verificado.*

> **Nota de severidad contextual:** las severidades EMT-C04 y EMT-C05 dependen de la visibilidad del repositorio. Si el repositorio es **privado y de acceso restringido**, el riesgo inmediato es Alto; si es público o de acceso amplio (colaboradores externos, forks), es **Crítico** con potencial de incidente de divulgación regulatoria. En ambos casos, los secretos deben rotarse porque ya fueron empujados a un remoto compartido.

---

## 1bis. Estado de remediación (14 de junio de 2026)

Tras la entrega del informe se ejecutó una **primera ronda de remediación** sobre los hallazgos críticos y altos. El estado se verificó (a) con la suite de tests (auth-api 8/8, main-api 87/87) y (b) con una verificación adversaria del código actual, finding por finding.

**Leyenda:** ✅ Cerrado (corregido en código/configuración y verificado) · 📄 Mitigación documentada (runbook listo, ejecución manual pendiente) · 🔴 Abierto (sin corregir aún).

| ID | Severidad | Estado | Qué se hizo / qué falta |
|----|-----------|--------|--------------------------|
| EMT-C01 | 🔴→✅ | **Cerrado** | Control de acceso por serial (`dataAccess.js` + middleware `dataSerialAccess.js`); se eliminó el fallback al último serial global. Modelo estricto por sub-empresa. Cubierto por tests. |
| EMT-C02 | 🔴→✅ | **Cerrado** | `sensors` e `history-export` validan cada `siteId` de la query (`findUnauthorizedSiteIds`) y devuelven 403. |
| EMT-C03 | 🔴→✅ | **Cerrado** | `protect` en `/api/metrics`, `/api/domains`, `/api/devices`; `POST /api/devices` solo Admin/SuperAdmin; `getDevices` acotado por empresa; `/api/status` saneado (sin error/entorno/uptime). |
| EMT-C04 | 🔴 | **📄 Documentado** | `RUNBOOK-FASE-0-secretos.md`. **Pendiente (ejecución manual):** rotar JWT/DGA/Resend/interna + purgar historia de Git. |
| EMT-C05 | 🔴 | **🔴 Abierto** | `historico_dga_OB-0601-292.csv` sigue versionado. Pendiente `git rm --cached` + `.gitignore` + purga de historia (RUNBOOK-FASE-0). |
| EMT-H01 | 🟠 | **📄 Documentado** | `RUNBOOK-FASE-1-puertos-cross-host.md`. **Pendiente:** auth (interceptor/mTLS) + TLS en gRPC csvconsumer/ftpconsumer y gRPC interno de main-api. |
| EMT-H02 | 🟠→✅ | **Cerrado** | `linux-db-api` ahora **fail-closed** (aborta sin `INTERNAL_API_KEY`, salvo override de dev) + comparación de clave en tiempo constante. |
| EMT-H03 | 🟠→✅ | **Cerrado (con firewall pendiente)** | DB/main-api/auth-api/frontend atados a `127.0.0.1`. Los 3 puertos cross-host (3010/50051/50061) quedan expuestos a propósito (consumidos entre máquinas) con firewall/auth/TLS documentados en RUNBOOK-FASE-1. |
| EMT-H04 | 🟠→✅ | **Cerrado** | `infra-db/docker-compose.yml` parametrizado (fail-if-missing); puertos de BD y pgAdmin a `127.0.0.1`. (Los valores viejos siguen en historia → entran en la purga de C04.) |
| EMT-H08 | 🟠→✅ | **Cerrado** | Lockout con backoff exponencial (15 min → 4 h), sin el recorte a 60 s; no se resetea el contador al expirar. |
| EMT-H09 | 🟠→✅ | **Cerrado** | Ventana de OTP 30 min/24 h → 10/15 min; OTP invalidado al bloquear la cuenta. |
| EMT-H10 | 🟠→✅ | **Cerrado** | Respuesta uniforme en `request-code`; `start` con correo desconocido devuelve flujo genérico (sin delatar existencia). Residual: `start` aún revela modo setup/otp de correos existentes (limitación de UX). |
| EMT-H12 | 🟠→✅ | **Cerrado** | Gate de aprobación activo en el environment `production` (required reviewers); un único deploy automático (self-hosted), ruta SSH manual, sin carrera (grupo de concurrencia compartido). Pendiente (infra): runner no-root/efímero. |

**Resumen:** de los 5 críticos, **3 cerrados en código** (C01–C03) y **2 dependen de acción manual** (C04 documentado, C05 abierto). De los altos abordados, **6 cerrados** (H02, H03, H04, H08, H09, H10) + **H12 cerrado**; **H01 documentado**. El resto de altos/medios/bajos del informe sigue pendiente de priorización.

> **Acción más urgente para Emeltec:** ejecutar la **Fase 0** (`RUNBOOK-FASE-0-secretos.md`) — rotar los secretos filtrados y purgar la historia. La corrección de código NO protege los valores que ya están en la historia de Git.

### Rev. 3 — Re-auditoría (14/06) y remediación de la capa v2

Una **re-auditoría fresca** reveló que la primera remediación solo cubrió la capa **v1** (`/api/data/*`, JavaScript). La plataforma tiene una **segunda capa v2 en TypeScript** (la que corre en producción vía `dist/`) que exponía los mismos datos. Se corrigió:

| Hallazgo (capa v2 / TS) | Severidad | Estado | Detalle |
|----|-----------|--------|---------|
| `/api/v2/telemetry/*` **sin autenticación** | 🔴 Crítica | **Cerrado** | `protect` + middleware `requireTelemetrySerialAccess` (reutiliza la lógica v1 `dataAccess`). Sin serial → último del propio usuario, nunca global. |
| IDOR `/api/v2/dga/sites/:siteId/*` (lectura + **escritura** config DGA) | 🟠 Alta | **Cerrado** | Middleware `requireSiteParamAccess` carga el sitio y valida propiedad. |
| IDOR `/api/v2/sites/:siteId/analisis/*` y `/bitacora/*` | 🟠 Alta | **Cerrado** | Idem `requireSiteParamAccess`. |
| IDOR contadores y operación-config (`/sites/:siteId/*`) | 🟠 Alta | **Cerrado** | `requireSiteAccess('siteId')` en `companyRoutes.js`. |
| `/api/metrics` sin scope por tenant | 🟡 Media | **Cerrado** | Filtra por los seriales de la empresa del usuario; sin serial usa el del usuario, no el global. |
| `alertaController` modelo de acceso divergente (por creador) | 🟡 Media | **Cerrado** | Unificado a `canAccessSite` (empresa/sub-empresa). |
| `permissions.canReadSite` (v2) divergía de `canAccessSite` (v1) | 🔵 Baja | **Cerrado** | Alineado, incluido el fallback "sin sub-empresa = toda la empresa". |

Verificación: typecheck 0 errores, 87 tests (vitest) verdes, lint 0 errores.

> **Lección:** `main-api` tiene **dos implementaciones paralelas** (v1 `.js` legacy + v2 `.ts` productiva) de los mismos datos. Todo control de acceso debe cubrir AMBAS. La solución reutiliza `services/dataAccess.js` como **fuente única de verdad** para las dos capas.

### Pendientes (al 14/06, Rev. 3)

**Acción manual del equipo (lo más urgente):**
- **EMT-C04 / Fase 0** — rotar secretos filtrados (JWT, DGA, Resend, interna, DB) y purgar la historia de Git. Mientras no se haga, los secretos siguen comprometidos.
- **EMT-C05** — el CSV ya se sacó del HEAD e ignoró, pero **falta purgarlo de la historia** (va junto con la Fase 0).
- **Commit + redeploy** — todos los arreglos están sin commitear; producción sigue con el código viejo hasta que se desplieguen.

**Pendiente de implementar (requiere coordinación):**
- **EMT-H01** — auth + TLS en gRPC (csvconsumer/ftpconsumer + gRPC interno de main-api). Cross-service Rust+Go (`RUNBOOK-FASE-1`).
- **auth-api (alto/medio)** — invalidar OTP en cada intento fallido (hoy solo al bloquear); aplicar el limiter estricto a `/start`; reducir la enumeración residual de `/start`; pinear `algorithms` en `jwt.verify` de tokens de challenge.
- **Higiene de repo/infra** — desversionar `auth-api/node_modules`; correr contenedores Node/nginx como no-root; fijar imágenes por digest (no `:latest`); pinear GitHub Actions por SHA.
- **Resto** del informe: medios/bajos no priorizados (CORS fail-closed, rol de mínimo privilegio en BD, ledger de migraciones, headers en metrics-page/landing, etc.).

---

## 2. Alcance y metodología

### 2.1 Servicios auditados

| Servicio | Tecnología | Superficie de riesgo principal |
|----------|-----------|-------------------------------|
| `auth-api` | Node.js + Express | Autenticación, JWT, OTP, códigos de acceso |
| `main-api` | Node.js + Express | Lógica de negocio, datos multi-tenant, gRPC |
| `linux-db-api` | Rust (axum) | Acceso directo a BD, comandos PLC (OT) |
| `grpc-pipeline` (csvconsumer) | Rust (tonic) | Ingesta de telemetría vía gRPC |
| `ftp-pipeline` (ftpconsumer) | Rust (tonic) | Ingesta de telemetría vía gRPC |
| `frontend-angular` | Angular 21 | XSS, manejo de token en cliente |
| `metrics-page` | JS estático + Vite | Renderizado de métricas |
| `landing-emeltec` | HTML/CSS/JS estático | Sitio público |
| `infra-db` | TimescaleDB/PostgreSQL | Credenciales, persistencia, init |
| `infra-nginx` | Nginx | TLS de borde, headers, proxy |
| CI/CD | GitHub Actions + scripts | Deploy, migraciones, secretos |

### 2.2 Dimensiones cubiertas

1. **Vulnerabilidades de código (SAST manual)** — inyección SQL, XSS, IDOR / control de acceso roto, manejo de JWT, validación de entrada, mass assignment, SSRF, inyección de comandos, etc.
2. **Dependencias / supply-chain** — `pnpm audit`, inspección de `Cargo.lock`/`Cargo.toml`, integridad de lockfiles.
3. **Infraestructura y configuración** — Docker, Nginx, TLS, exposición de puertos, gestión de secretos, CI/CD.
4. **Cumplimiento OWASP** — mapeo de cada hallazgo a OWASP Top 10 2021.

### 2.3 Escala de severidad

| Severidad | Criterio |
|-----------|----------|
| 🔴 **Crítica** | Compromiso directo de confidencialidad/integridad de datos de múltiples clientes, bypass de autenticación, o exposición de secretos productivos. Explotable con esfuerzo bajo. |
| 🟠 **Alta** | Compromiso significativo (un cliente, un servicio) o que requiere una precondición razonable. |
| 🟡 **Media** | Debilidad explotable bajo condiciones específicas o que reduce la defensa en profundidad. |
| 🔵 **Baja / Info** | Endurecimiento, higiene, o riesgo residual aceptable. |

Los valores **CVSS 3.1** son estimaciones de referencia. Donde CVSS sub-representa el impacto de negocio (típico en IDOR sobre datos multi-tenant regulados), prevalece la severidad contextual indicada.

---

## 3. Resumen de hallazgos

| ID | Severidad | Título | Servicio | OWASP | Estado |
|----|-----------|--------|----------|-------|--------|
| EMT-C01 | 🔴 Crítica | IDOR en `/api/data/*` — lectura de telemetría entre clientes | main-api | A01 | Verificado |
| EMT-C02 | 🔴 Crítica | Bypass de autorización cold-room vía `?siteIds` | main-api | A01 | Verificado |
| EMT-C03 | 🔴 Crítica | Endpoints sin autenticación + escritura anónima (`POST /api/devices`) | main-api | A01/A07 | Verificado |
| EMT-C04 | 🔴 Crítica | Secretos productivos en historia de Git (JWT, DGA, Resend, interna) | repo | A02/A07 | Verificado |
| EMT-C05 | 🔴 Crítica | Datos regulatorios reales DGA versionados (CSV + comprobantes) | repo | A01/A04 | Verificado |
| EMT-H01 | 🟠 Alta | Ingesta gRPC sin autenticación ni TLS (50051/50061) | grpc/ftp | A01/A07 | — |
| EMT-H02 | 🟠 Alta | `linux-db-api` autenticación fail-open + comandos PLC sin authz | linux-db-api | A07/A01 | — |
| EMT-H03 | 🟠 Alta | Puertos de BD e ingesta expuestos a `0.0.0.0` (Internet) | infra | A05 | — |
| EMT-H04 | 🟠 Alta | Credenciales débiles hardcodeadas en `infra-db/docker-compose.yml` | infra-db | A05/A07 | Verificado |
| EMT-H05 | 🟠 Alta | Inyección de `sitio_id` entre clientes en alerta/incidencia/documento | main-api | A01 | — |
| EMT-H06 | 🟠 Alta | Escalada de privilegios: Admin crea Admin / sub_empresa arbitraria | main-api | A01 | — |
| EMT-H07 | 🟠 Alta | `tieneAcceso` sobre-otorga cuando el token no trae `sub_empresa_id` | main-api | A01 | — |
| EMT-H08 | 🟠 Alta | Lockout de cuenta trivialmente evadible (clamp a 60 s) | auth-api | A07 | — |
| EMT-H09 | 🟠 Alta | Ventana de fuerza bruta de OTP demasiado amplia | auth-api | A07 | — |
| EMT-H10 | 🟠 Alta | Enumeración de usuarios/cuentas | auth-api/main-api | A07 | — |
| EMT-H11 | 🟠 Alta | JWT en `localStorage` exfiltrable por XSS (tradeoff de diseño) | frontend | A07 | — |
| EMT-H12 | 🟠 Alta | Deploy en cada push a `main` sin gate de aprobación | CI/CD | A08 | — |
| EMT-M01 | 🟡 Media | CORS permisivo / wildcard por defecto | auth/main/linux | A05 | — |
| EMT-M02 | 🟡 Media | Fuerza del `JWT_SECRET` no validada; guía inconsistente (16 vs 32) | auth-api/infra | A02 | — |
| EMT-M03 | 🟡 Media | Nginx de borde sin headers de seguridad, HSTS ni TLS endurecido | infra-nginx | A05/A02 | — |
| EMT-M04 | 🟡 Media | Contenedores Node y Nginx corren como root | infra | A05 | — |
| EMT-M05 | 🟡 Media | La app conecta como superusuario Postgres (sin mínimo privilegio) | infra-db | A01/A05 | — |
| EMT-M06 | 🟡 Media | gRPC y conexión a BD en texto plano (NoTls) | grpc/ftp/linux | A02 | — |
| EMT-M07 | 🟡 Media | Cola en memoria sin límite en csvconsumer (DoS) | grpc-pipeline | A04 | — |
| EMT-M08 | 🟡 Media | Fuga de detalle de errores de BD al cliente | varios | A05/A09 | — |
| EMT-M09 | 🟡 Media | `auth-api` con `COPY . .` sin `.dockerignore` propio | auth-api | A05/A08 | — |
| EMT-M10 | 🟡 Media | Imágenes base sin fijar (tags flotantes, sin digest) | infra | A08 | — |
| EMT-M11 | 🟡 Media | Migraciones sin ledger/versionado en cada deploy | CI/CD | A08 | — |
| EMT-M12 | 🟡 Media | CSP del frontend con `script-src 'unsafe-inline'` | frontend | A05 | — |
| EMT-M13 | 🟡 Media | esbuild dev-only (GHSA-gv7w-rqvm-qjhr / -g7r4) | frontend/main | A06 | Riesgo aceptado |
| EMT-L01 | 🔵 Baja | `metrics-page` / `landing` sin headers de seguridad | infra | A05 | — |
| EMT-L02 | 🔵 Baja | Password de Redis por línea de comando (visible en `ps`) | infra | A05 | — |
| EMT-L03 | 🔵 Baja | Acciones de terceros fijadas por tag, no SHA | CI/CD | A08 | — |
| EMT-L04 | 🔵 Baja | Seed/demo data en init de producción | infra-db | A05 | — |
| EMT-L05 | 🔵 Info | `view_as` confiado en cliente (requiere confirmar authz server-side) | frontend | A01 | — |
| EMT-L06 | 🔵 Baja | Falta `Cargo.lock` en csvconsumer; orden de validación de `mode` | grpc/auth | A08/A04 | — |
| EMT-L07 | 🔵 Baja | `.dga_res_2170.txt` (documento público) versionado | repo | — | — |
| EMT-L08 | 🔵 Baja | `.gitignore` sin cobertura para `*.csv`/`*.pem`/`*.key`/dumps | repo | A05 | — |
| EMT-L09 | 🔵 Baja | Inyección de fórmulas CSV sin guard en exportaciones | main-api | A03 | — |
| EMT-L10 | 🔵 Info | IP interna hardcodeada en `.env.example` (`145.190.8.19`) | infra | — | — |

---

## 4. Hallazgos críticos (detalle)

### 🔴 EMT-C01 — IDOR en `/api/data/*`: lectura de telemetría entre clientes

- **OWASP:** A01:2021 Broken Access Control · **CVSS 3.1 estimado:** 6.5 (AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N) · **Severidad contextual: Crítica** (brecha masiva de datos multi-tenant regulados)
- **Ubicación:** `main-api/src/routes/dataRoutes.js:18-24`; `main-api/src/controllers/dataController.js:331-332, 365-366, 407-408, 447-448, 497-498, 596-597, 663-664`
- **Descripción:** Todas las rutas `/api/data/*` aplican únicamente el middleware `protect` (autenticación), montadas en `app.js:101` sin envoltura adicional. Los handlers leen `serial_id`/`id_serial` directamente desde la query (`resolveSerialId`) y consultan la tabla `equipo` con `WHERE id_serial = $1`, **sin verificar que el serial pertenezca a la empresa/sub-empresa del solicitante**. La variable `req.user.empresa_id` no se referencia en ningún punto de `dataController.js`. Además, `resolveSerialId(null)` devuelve "el último serial de la tabla", filtrando un dispositivo ajeno incluso sin parámetro.
- **Impacto:** Cualquier usuario autenticado (incluido el rol `Cliente`) lee telemetría en vivo e histórica de cualquier dispositivo de cualquier empresa enumerando seriales. Brecha total de confidencialidad de los datos de monitoreo.
- **Verificación adversaria:** CONFIRMADO. Se buscó activamente cualquier control de propiedad y no existe ninguno; el camino contrasta con `companyController` y `pasteurizadorController`, que sí aplican `canReadSite`.
- **Remediación:** Resolver `serial → sitio → (empresa_id, sub_empresa_id)` y aplicar `canReadSite(req.user, sitio)` antes de consultar `equipo`. Rechazar cuando el serial no pertenezca al alcance del usuario. Aplicar el mismo control a los handlers gRPC de `src/grpc/server.js` (ver EMT-H01).

### 🔴 EMT-C02 — Bypass de autorización en cold-room vía `?siteIds`

- **OWASP:** A01:2021 Broken Access Control · **CVSS 3.1 estimado:** 6.5 · **Severidad contextual: Crítica**
- **Ubicación:** `main-api/src/middlewares/coldRoomAccess.js:33`; `main-api/src/routes/coldRoomRoutes.js:1151-1155` (sensors), `1312-1316` (history-export), consultas `WHERE id = ANY($1)`/`WHERE sitio_id = ANY($1)` en `999, 1011, 1329, 1342, 1384`
- **Descripción:** La autorización es `router.use('/:siteId', requireSiteAccess('siteId'))`, que valida **solo** `req.params.siteId`. Pero `GET /:siteId/sensors` y `GET /:siteId/history-export` construyen la lista a consultar desde `req.query.siteIds` (el parámetro de ruta es solo fallback) y la inyectan en `... = ANY($1)` sin validar cada elemento.
- **Impacto:** Un usuario con acceso legítimo a un sitio `S100` llama `GET /api/cold-room/S100/sensors?siteIds=S100,S999` y obtiene datos de sensores / exportación histórica de `S999` (otro cliente). El middleware da una **falsa sensación de protección**.
- **Verificación adversaria:** CONFIRMADO. Los endpoints de mutación (umbrales, defrost, acks) NO están afectados porque usan `req.params.siteId` validado; el bypass es específico de los dos endpoints de lectura que honran `req.query.siteIds`.
- **Remediación:** Validar cada id de `req.query.siteIds` contra el alcance del usuario (iterar `requireSiteAccess`/`lookupSite` por id, o filtrar la consulta a los sitios que el usuario puede leer). Nunca confiar en una lista de sitios de query/body no autorizada.

### 🔴 EMT-C03 — Endpoints sin autenticación con escritura anónima

- **OWASP:** A01:2021 Broken Access Control / A07 · **CVSS 3.1 estimado:** 8.2 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:N) · **Severidad contextual: Crítica**
- **Ubicación:** `main-api/src/app.js:100, 102, 103`; `main-api/src/routes/catalogRoutes.js:8-10`; `main-api/src/controllers/catalogController.js:107-164`; `statusRoutes.js`, `metricsRoutes.js`
- **Descripción:** Los routers `statusRoutes` (`/api/status`), `catalogRoutes` (`/api/...`) y `metricsRoutes` (`/api/metrics`) se montan **sin `protect`**, y los propios routers tampoco lo aplican. En particular `POST /api/devices` (`createDevice`) ejecuta un upsert (`INSERT ... ON CONFLICT (serial_id) DO UPDATE`) en `public.devices` sin ninguna referencia a `req.user`.
- **Impacto:** Un atacante anónimo puede: (a) crear/sobrescribir registros del catálogo de dispositivos; (b) leer `/api/status` (topología y salud interna: BD, auth-api, pipeline gRPC); (c) leer `/api/metrics`, `/api/domains`, `/api/devices`.
- **Verificación adversaria:** CONFIRMADO. Único mitigante: si la tabla `public.devices` no existe, `createDevice` devuelve 400.
- **Remediación:** Añadir `protect` a los tres routers y `authorizeRoles('SuperAdmin'|'Admin')` a `POST /api/devices`. Restringir `/api/status` y `/api/metrics` a administradores autenticados o a red interna.

### 🔴 EMT-C04 — Secretos productivos en la historia de Git

- **OWASP:** A02:2021 Cryptographic Failures / A07 · **CWE-798** · **Severidad contextual: Crítica** (condicionada a visibilidad del repo)
- **Ubicación (historia, accesible desde `origin/main`):**
  - `.env` @ `0276eab`: `JWT_SECRET` (64 hex), `DGA_ENCRYPTION_KEY` (64 hex), `RESEND_API_KEY` (`re_…`, 36 chars), `INTERNAL_API_KEY`, `POSTGRES_PASSWORD`
  - `auth-api/.env` y `main-api/.env` @ `a5e7dd6~1`: `JWT_SECRET=super_secret_dev_key_12345` (débil, **reutilizado entre ambos servicios**), `DB_PASSWORD`, y la misma `RESEND_API_KEY` live
- **Descripción:** Los archivos `.env` fueron retirados de HEAD (commits `0acd470`, `a5e7dd6`) pero **persisten en la historia** y fueron empujados al remoto compartido. `git ls-files` confirma que HEAD ya no los rastrea, pero `git log --all -S "<secreto>"` confirma que los valores siguen accesibles desde `main` y desde otras ramas remotas.
- **Impacto:**
  - **JWT_SECRET filtrado → bypass total de autenticación.** Cualquiera con el secreto forja JWTs válidos con `tipo`/`empresa_id` arbitrarios → suplantación de cualquier usuario y acceso entre clientes. El secreto compartido entre auth-api y main-api significa que comprometer uno compromete ambos.
  - **DGA_ENCRYPTION_KEY filtrada →** compromiso de la confidencialidad de credenciales/datos de envío a la DGA.
  - **RESEND_API_KEY filtrada →** envío de correo como `noreply@emeltec.cl` (phishing a clientes B2B).
  - **INTERNAL_API_KEY filtrada →** falsificación de la confianza servicio-a-servicio.
- **Verificación adversaria:** CONFIRMADO con corrección de alcance: el set completo está en `0276eab`; `e66191f` filtra solo la `DGA_ENCRYPTION_KEY`; `2595c4f` filtra solo `POSTGRES_PASSWORD`. La conclusión sustantiva se mantiene.
- **Remediación (en orden):**
  1. **ROTAR de inmediato** `JWT_SECRET` (invalida sesiones — esperado), `DGA_ENCRYPTION_KEY` (re-cifrar datos sellados con la clave antigua), `RESEND_API_KEY` (revocar en el panel de Resend), `INTERNAL_API_KEY` y las contraseñas de BD. Tratar todos como comprometidos.
  2. **Purgar de la historia** con `git filter-repo --invert-paths --path .env --path auth-api/.env --path main-api/.env` (o BFG), force-push, y exigir re-clonado a todos los colaboradores.
  3. Estandarizar generación con `openssl rand -hex 32` (256 bits) y validar fuerza al arrancar (ver EMT-M02).

### 🔴 EMT-C05 — Datos regulatorios reales de la DGA versionados

- **OWASP:** A01 / A04 · **CWE-540** · **Severidad contextual: Crítica/Alta** (según visibilidad del repo)
- **Ubicación:** `historico_dga_OB-0601-292.csv` (rastreado en HEAD, no ignorado)
- **Descripción:** Archivo de 18.588 filas de telemetría real de la obra de extracción `OB-0601-292`: columnas `codigo_obra, measurement_date, measurement_time, flow, level, totalizator, sent_at, api_n_comprobante`, abarcando 2024-03-25 a 2026-05-14, con **13.702 tokens distintos de comprobante DGA** (`api_n_comprobante`, p. ej. `2ebeb58fc029fe1c…`). Son identificadores de recibo de envío a la DGA de un punto de extracción regulado real. `git check-ignore` confirma que **no está ignorado**.
- **Impacto:** Datos de cliente y regulatorios productivos (volúmenes de extracción, niveles, totalizadores, recibos de envío) permanentes en la historia de Git. Posible incidente de divulgación regulatoria; los tokens de comprobante podrían correlacionarse/reproducirse contra la API de la DGA.
- **Verificación adversaria:** CONFIRMADO (contenido y conteo verificados).
- **Remediación:** `git rm --cached historico_dga_OB-0601-292.csv`, añadir patrones de datos a `.gitignore` (EMT-L08), y purgar de la historia con `git filter-repo`/BFG. Confirmar con la DGA si los tokens de comprobante son sensibles y, de serlo, rotarlos. Mover los volcados de datos a almacenamiento seguro fuera del repositorio.

---

## 5. Hallazgos altos (detalle)

### 🟠 EMT-H01 — Ingesta gRPC sin autenticación ni TLS

- **OWASP:** A01 / A07 · **Ubicación:** `grpc-pipeline/csvconsumer-rust/src/main.rs:258-261`; `ftp-pipeline/ftpconsumer-rust/src/main.rs:196-199`; cliente Go con `insecure.NewCredentials()` (`grpc-pipeline/csvprocessor/internal/grpcclient/client.go:12-14`); `docker-compose.yml:174-175, 189-190`
- **Descripción:** Ambos servidores gRPC usan `serve()` sin interceptor, sin TLS y sin validación de token, en `0.0.0.0:50051`/`50061`, con esos puertos publicados al host. ARCHITECTURE.md declara explícitamente "Sin TLS en gRPC".
- **Impacto:** Cualquiera con alcance de red a esos puertos inyecta filas arbitrarias de telemetría en la tabla `equipo` para cualquier `id_serial`. Compromete la **integridad del registro regulatorio DGA** (datos falsos de caudal/nivel reportables).
- **Remediación:** Exigir autenticación (interceptor tonic validando token, o mTLS). **No publicar** estos puertos al host si solo `main-api` los consume en la red interna de Docker — eliminar el mapeo `ports:`. Habilitar TLS.

### 🟠 EMT-H02 — `linux-db-api`: autenticación fail-open + comandos PLC sin authz por identidad

- **OWASP:** A07 / A01 · **Ubicación:** `linux-db-api/src/main.rs:274-291, 802-805, 361-458`
- **Descripción:** `require_api_key` solo exige la clave `if !state.api_key.is_empty()`; si `INTERNAL_API_KEY` está vacía, el servidor arranca con **todos los endpoints `/api/*` abiertos** (solo loguea un warning). El puerto `3010` se publica al host. Además, el único control es una clave global comparada con `!=` (no constante en tiempo) y `requested_by` es texto libre del llamante, sin vínculo a un principal autenticado.
- **Impacto:** Con la clave vacía, un atacante no autenticado encola **comandos PLC arbitrarios** (`POST /api/plc/commands`) — escritura de tags a controladores industriales (ruta OT). Fail-open en un plano de control industrial.
- **Remediación:** **Fail-closed**: si `INTERNAL_API_KEY` está vacía fuera de desarrollo, abortar el arranque. Vincular comandos a una identidad de servicio autenticada y a un alcance por `id_serial`/tenant. Considerar mTLS. Usar comparación constante en tiempo.

### 🟠 EMT-H03 — Puertos de BD e ingesta expuestos a `0.0.0.0`

- **OWASP:** A05 · **Ubicación:** `docker-compose.yml:40-41` (db 5433), `81-82` (3010), `174-175` (50051), `189-190` (50061), `59-60` (3000), `119-120` (3001), `141-142` (5173)
- **Descripción:** Estos mapeos no llevan prefijo de IP de host, por lo que Docker los enlaza a `0.0.0.0` e inserta reglas iptables que **saltan UFW** en Linux. Solo `metrics-page` y `landing` están correctamente en `127.0.0.1`. El proxy Nginx alcanza los servicios por la red interna, así que ninguno de esos puertos necesita binding de host. `provision_vm.sh:34-35` incluso publicita `http://<ip-pública>:5173` y `:3000`.
- **Impacto:** TimescaleDB (con toda la telemetría de clientes + DGA), los endpoints de ingesta Rust sin auth y las APIs quedan accesibles directamente desde Internet, saltando TLS y la capa Nginx.
- **Remediación:** Prefijar con `127.0.0.1:` todo servicio que Nginx fronteree; la BD, los consumidores gRPC y `linux-db-api` **sin** puerto de host (solo red interna). Corregir el binding primero, ya que Docker salta UFW.

### 🟠 EMT-H04 — Credenciales débiles hardcodeadas en `infra-db/docker-compose.yml`

- **OWASP:** A05 / A07 · **CWE-798** · **Ubicación:** `infra-db/docker-compose.yml:16, 38` (HEAD) · *Verificado*
- **Descripción:** `POSTGRES_PASSWORD: Infra2026Secure!` y `PGADMIN_DEFAULT_PASSWORD: Admin2026!` están como literales (no `${VAR}`), y pgAdmin se publica en `5050:80` a `0.0.0.0`. Estas credenciales están en el **HEAD actual**, no solo en la historia.
- **Impacto:** Cualquiera con acceso de lectura al repo obtiene credenciales funcionales de BD + pgAdmin; si esta composición se ejecuta en/cerca de producción, toma total del UI de administración de la BD.
- **Remediación:** Reemplazar por `${POSTGRES_PASSWORD}`/`${PGADMIN_DEFAULT_PASSWORD}` desde `.env`, rotar las contraseñas, y enlazar pgAdmin a `127.0.0.1`.

### 🟠 EMT-H05 — Inyección de `sitio_id` entre clientes en alerta/incidencia/documento

- **OWASP:** A01 (mass assignment / validación débil) · **Ubicación:** `main-api/src/controllers/alertaController.js:49-109`; `incidenciaController.js:144-243`; `documentoController.js:121-207`
- **Descripción:** Estos handlers validan que el `empresa_id` provisto coincida con el del usuario, pero **nunca validan que el `sitio_id` pertenezca a esa empresa/sub-empresa**. Insertan con `sub_empresa_id = req.user.sub_empresa_id ?? null`. El patrón correcto existe en `createOperationalContact` (`companyController.js:2966-2974`) pero no se aplica consistentemente.
- **Impacto:** Un `Cliente`/`Gerente` adjunta alertas/incidencias/documentos a un `sitio_id` de otra sub-empresa; para documentos, el blob se escribe en el prefijo de almacenamiento de otro sitio (`buildBlobPath`).
- **Remediación:** Validar `sitio_id` contra `(empresa_id, sub_empresa_id)` antes del insert, reutilizando el `SELECT ... FROM sitio WHERE id=$1 AND empresa_id=$2 AND sub_empresa_id=$3` ya existente.

### 🟠 EMT-H06 — Escalada de privilegios: Admin puede crear Admin

- **OWASP:** A01 · **Ubicación:** `main-api/src/controllers/userController.js:294-336`, `441`
- **Descripción:** Para un `Admin`, el único bloqueo de rol es `if (tipo === 'SuperAdmin') return 403`, por lo que un Admin puede crear otro usuario `tipo='Admin'` en su empresa. Además controla `sub_empresa_id` libremente sin validar que pertenezca a su empresa. Combinado con `deleteUser` (Admin borra cualquier usuario de la empresa), permite crecimiento no acotado de la población de administradores.
- **Impacto:** Crecimiento horizontal/vertical de privilegios dentro del tenant; asignación de usuarios a sub-empresas arbitrarias.
- **Remediación:** Definir una allow-list explícita de roles que cada rol puede crear (¿Admin debe poder crear Admin? — confirmar regla de negocio). Validar `sub_empresa_id ∈ empresa del solicitante`.

### 🟠 EMT-H07 — `tieneAcceso` sobre-otorga cuando el token no trae `sub_empresa_id`

- **OWASP:** A01 · **Ubicación:** `main-api/src/controllers/documentoController.js:23-28, 59-65`; `incidenciaController.js:12-18, 59-65`; `alertaController.js:253, 476`
- **Descripción:** `tieneAcceso` retorna verdadero si `doc.empresa_id === req.user.empresa_id` y solo restringe por sub-empresa **cuando `req.user.sub_empresa_id` es truthy**. Un `Cliente`/`Gerente` cuyo JWT tenga `sub_empresa_id` nulo gana acceso a TODOS los documentos/incidencias de la empresa.
- **Impacto:** Bypass del aislamiento por sub-empresa para cualquier rol cuyo token omita `sub_empresa_id`.
- **Remediación:** Hacer el scoping explícito por rol: `Gerente`/`Cliente` DEBEN tener y ser filtrados por `sub_empresa_id`; rechazar la petición si falta.

### 🟠 EMT-H08 — Lockout de cuenta trivialmente evadible

- **OWASP:** A07 · **Ubicación:** `auth-api/src/controllers/authController.js:14-15, 135-146, 192-228`
- **Descripción:** `LOCKOUT_THRESHOLD=5`, `LOCKOUT_DURATION_MS=60s`. Peor aún, `ensureNotLocked` **recorta** cualquier bloqueo a 60 s (`effectiveLockedUntil = min(lockedUntil, now+60s)`) y reinicia `failed_logins` a 0 tras desbloquear. Resultado: 5 intentos por minuto por cuenta indefinidamente (~7.200/día), sin backoff exponencial ni bloqueo permanente.
- **Impacto:** Fuerza bruta sostenida de contraseña/OTP. Combinado con EMT-H09, hace factible adivinar OTPs a escala.
- **Remediación:** Backoff exponencial, duración de bloqueo significativa (15 min escalando), NO recortar el bloqueo almacenado a 60 s, y no reiniciar el contador a cero (decaerlo). Rastrear por (cuenta + IP) y globalmente.

### 🟠 EMT-H09 — Ventana de fuerza bruta de OTP demasiado amplia

- **OWASP:** A07 · **Ubicación:** `auth-api/src/controllers/authController.js:11-12, 68-71, 87-97, 163-166`
- **Descripción:** El OTP (6 chars sobre alfabeto de 32, ~30 bits — entropía adecuada) tiene validez por defecto `DEFAULT_OTP_MINS=30` y hasta `MAX_OTP_MINS=1440` (24 h). Un OTP incorrecto **no** lo invalida (solo se limpia en login exitoso), así que el mismo código sigue válido durante toda la ventana mientras el atacante adivina, limitado solo por el lockout recortado (EMT-H08) y el limiter por IP (evadible distribuyendo IPs).
- **Impacto:** Adivinación de OTP en línea factible, especialmente en cuentas `otp`-only donde el OTP es el único factor.
- **Remediación:** Reducir TTL por defecto/máximo (5–10 min, máx 15). Contador de intentos por-OTP (invalidar tras 5 fallos, no solo en éxito). Conteo de fallos independiente de la IP.

### 🟠 EMT-H10 — Enumeración de usuarios/cuentas

- **OWASP:** A07 · **Ubicación:** `auth-api/src/controllers/authController.js:338-368, 586-598`; `main-api/src/controllers/authController.js:104-126`
- **Descripción:** `requestCode` responde `403` para correo desconocido y `200` para conocido — oráculo de existencia directo. `startLogin` es peor: revela estado y método de autenticación por cuenta a un llamante no autenticado (`flow: 'setup'|'password'|'otp'`).
- **Impacto:** Construir listas de correos corporativos válidos, identificar cuentas no activadas (objetivos de account-takeover por el flujo setup) y adaptar el ataque al método de auth.
- **Remediación:** Respuesta uniforme y genérica independiente de la existencia/estado ("Si el correo está registrado, recibirás instrucciones"). No ramificar la respuesta pública según `activated_at`/`auth_mode`.

### 🟠 EMT-H11 — JWT en `localStorage` exfiltrable por XSS

- **OWASP:** A07 / A05 · **Ubicación:** `frontend-angular/src/app/services/auth.service.ts:124, 146-147, 269-270`; `interceptors/auth.interceptor.ts:24`
- **Descripción:** El token bearer y `user_data` viven en `localStorage`, legibles por cualquier JS del origen. Es un **tradeoff de diseño**, no un bug categórico: el patrón `Authorization: Bearer` requiere almacenamiento legible por JS. Pero para una plataforma B2B IIoT regulada, las cookies `httpOnly` ofrecen mejor postura de defensa en profundidad.
- **Impacto:** Cualquier XSS, dependencia npm comprometida o extensión con acceso a la página puede robar `jwt_token` → secuestro de sesión. El riesgo se agrava con EMT-M12 (`unsafe-inline` en CSP).
- **Remediación:** Preferible — mover la sesión a cookie `httpOnly; Secure; SameSite=Strict` emitida por `auth-api` (el proxy Nginx ya sirve `/api/` same-origin). Si se mantiene el patrón bearer, tratar como riesgo residual aceptado y compensar con CSP estricta (EMT-M12) + SRI.

### 🟠 EMT-H12 — Deploy en cada push a `main` sin gate de aprobación

- **OWASP:** A08 · **Ubicación:** `.github/workflows/deploy-selfhosted.yml:8-12, 19-20, 32-33`; `scripts/deploy-production.sh:73-81, 84`
- **Descripción:** `on: push: branches: [main]` dispara un runner `[self-hosted, Linux]` que ejecuta `deploy-production.sh` **directamente en la VM de producción** — construye imágenes y aplica todas las migraciones `infra-db/migrations/*.sql` contra la BD viva, sin reviewer requerido. Existen dos workflows de deploy que disparan en push a main y pueden correr simultáneamente.
- **Impacto:** Cualquier merge a main (o commit de un mantenedor comprometido) ejecuta código no revisado como el usuario del runner en la VM con acceso a Docker (equivalente a root) y derechos de migración sobre la BD. Dos deploys concurrentes pueden competir sobre el mismo proyecto/BD.
- **Remediación:** Exigir regla de protección `environment: production` con reviewers requeridos; consolidar a UN solo workflow; gatear el deploy self-hosted tras `workflow_dispatch` o un tag de release; runner no-root, efímero y aislado.

---

## 6. Hallazgos medios (resumen)

| ID | Hallazgo | Ubicación | Remediación |
|----|----------|-----------|-------------|
| EMT-M01 | CORS permisivo/wildcard por defecto | `auth-api/src/app.js:14-17`; `main-api/src/app.js:36-51` (default `*`); `linux-db-api/src/main.rs:788` (`permissive`) | Allow-list explícita de orígenes; fail-closed en producción |
| EMT-M02 | Fuerza de `JWT_SECRET` no validada; guía 16 vs 32 chars | `auth-api/src/config/requireEnv.js:5-12`; `main-api/.env.example` (16) vs `.env.example` (32) | Exigir ≥32 bytes al arrancar (fail-fast); estandarizar `openssl rand -hex 32` |
| EMT-M03 | Nginx de borde sin headers, HSTS, `server_tokens off` ni TLS endurecido; sin rate-limit en `/api/auth` | `infra-nginx/emeltec-sites.conf` | `server_tokens off`, `ssl_protocols TLSv1.2/1.3`, HSTS, `limit_req` en auth/api |
| EMT-M04 | Contenedores Node/Nginx como root | `main-api/Dockerfile`, `auth-api/Dockerfile`, frontends | `USER` no-root, `cap_drop:[ALL]`, `no-new-privileges`, `read_only`, límites |
| EMT-M05 | App conecta como superusuario Postgres | `docker-compose.yml:9`; `infra-db/init-db/01-init-schema.sql` | Rol de app con `SELECT/INSERT/UPDATE/DELETE` mínimos; superuser solo para migraciones |
| EMT-M06 | gRPC y conexión a BD en texto plano | `*-rust/src/main.rs` (`NoTls`, `sslmode=disable`) | TLS en gRPC y `sslmode=require/verify-full` a Postgres |
| EMT-M07 | Cola en memoria sin límite (DoS) | `grpc-pipeline/csvconsumer-rust/src/main.rs:246, 215-221` | Acotar la cola (backpressure `resource_exhausted`); `max_decoding_message_size` |
| EMT-M08 | Fuga de detalle de errores de BD al cliente | `auth-api/.../healthRoutes.js:14-20`; `main-api/.../coldRoomRoutes.js`; `linux-db-api/src/main.rs:449+` | Mensaje genérico al cliente; detalle solo en logs server-side |
| EMT-M09 | `auth-api` con `COPY . .` sin `.dockerignore` propio | `auth-api/Dockerfile:5` | Añadir `auth-api/.dockerignore` (`.env`, `node_modules`); multi-stage |
| EMT-M10 | Imágenes base sin fijar (`latest`/tags flotantes) | `docker-compose.yml` (timescaledb, redis, pgadmin), Dockerfiles | Fijar versión + digest; Renovate/Dependabot |
| EMT-M11 | Migraciones sin ledger/versionado | `scripts/deploy-production.sh:73-81` | Herramienta de migraciones con tabla `schema_migrations` transaccional |
| EMT-M12 | CSP del frontend con `script-src 'unsafe-inline'` | `frontend-angular/nginx.conf:18` | Quitar `'unsafe-inline'` de `script-src`; usar nonce/hash si hace falta |
| EMT-M13 | esbuild dev-only (GHSA-gv7w-rqvm-qjhr / -g7r4) | `pnpm-workspace.yaml` (ignoreGhsas) | Riesgo aceptado y documentado; resolver en migración Angular 21→22 |

---

## 7. Hallazgos bajos / informativos (resumen)

| ID | Hallazgo | Remediación |
|----|----------|-------------|
| EMT-L01 | `metrics-page`/`landing` sin headers de seguridad ni CSP | Portar el bloque de headers de `frontend-angular/nginx.conf` |
| EMT-L02 | Password de Redis por línea de comando (`--requirepass`, `-a`) | Config file montado como secret; `REDISCLI_AUTH` en healthcheck |
| EMT-L03 | Acciones de terceros fijadas por tag, no SHA | Fijar por commit SHA; Dependabot |
| EMT-L04 | Seed/demo data (Empresa Demo SpA) en init de producción | Gatear seed tras script dev-only |
| EMT-L05 | `view_as` confiado en cliente (UX gating) | Sin cambio frontend; **confirmar** que el backend re-autoriza la impersonación SuperAdmin en cada endpoint |
| EMT-L06 | Falta `Cargo.lock` en csvconsumer; orden de validación de `mode` en auth-api | Commitear `Cargo.lock`; validar whitelist de `mode` antes de derivar credential |
| EMT-L07 | `.dga_res_2170.txt` (regulación pública) versionado | Mover a `docs/` o eliminar (higiene) |
| EMT-L08 | `.gitignore` sin cobertura de datos/llaves | Añadir `*.csv`, `historico_*`, `*.pem`, `*.key`, `*.crt`, `*.dump`, `*.bak` |
| EMT-L09 | Inyección de fórmulas CSV en exportaciones | Prefijar `= + - @` con `'` en celdas de texto |
| EMT-L10 | IP interna hardcodeada en `.env.example` (`145.190.8.19`) | Parametrizar |

---

## 8. Dependencias / supply-chain

| Workspace | Herramienta | Resultado |
|-----------|-------------|-----------|
| `auth-api` | npm/pnpm audit | **0 vulnerabilidades** en el árbol resuelto. Versiones runtime actuales y parcheadas (`jsonwebtoken 9.0.3`, `bcrypt 6.0.0`, `express 5.2.1`, `pg 8.21.0`). |
| `main-api` | npm audit | **1 advisory alta dev-only** (esbuild GHSA-gv7w-rqvm-qjhr / -g7r4, vía vitest/vite/tsx). No está en el runtime productivo. Runtime sin CVEs (`multer 2.1.1`, `@azure/storage-blob 12.31.0`, `@grpc/grpc-js 1.14.4`, `zod 3.25.76`). |
| `frontend-angular` | pnpm audit | **2 advisories (1 alta, 1 baja), ambas dev-only y formalmente aceptadas** en `pnpm-workspace.yaml` (`ignoreGhsas`). esbuild no está en el bundle productivo. `xlsx` se sirve desde el tarball de SheetJS (recomendado por el proveedor) — **confirmar hash de integridad en `pnpm-lock.yaml`**. |
| `linux-db-api`, `csvconsumer`, `ftpconsumer` | inspección de `Cargo.lock` | Sin versiones con advisory crítico conocido (tokio 1.52.3, hyper 1.10.1, axum 0.7.9, tonic 0.12.3, tokio-postgres 0.7.17). `cargo-audit` no está instalado — **recomendado añadirlo a CI**. csvconsumer no tiene `Cargo.lock` commiteado (EMT-L06). |
| `metrics-page` | — | Vite (build-only), versiones actuales. |
| `landing-emeltec` | — | Sin `package.json`; estático puro, sin superficie de dependencias. |

**Recomendaciones supply-chain:** (1) commitear lockfiles donde falten (csvconsumer); (2) usar `npm ci`/instalación con lockfile en los Dockerfiles en lugar de resolver rangos `^` en build (EMT-M10); (3) añadir `cargo audit`, `pnpm audit` y escaneo de imágenes (Trivy/Grype) al pipeline de CI; (4) habilitar Dependabot/Renovate.

---

## 9. Buenas prácticas observadas

La plataforma presenta una base de seguridad madura en múltiples áreas:

- **Sin inyección SQL.** Todas las consultas en los seis servicios usan placeholders parametrizados (`$1..$n`); los fragmentos dinámicos están limitados a allow-lists de nombres de vista/tabla.
- **Hashing fuerte.** bcrypt cost 12 para contraseñas y OTP; OTPs hasheados en reposo, de un solo uso y con expiración; generación con CSPRNG (`crypto.randomInt`).
- **JWT correcto en verificación.** Algoritmo fijado (`algorithms:['HS256']`, previene `alg:none`/confusión), `requireEnv` con fail-fast, TTL acotado.
- **Comparación timing-safe** de `INTERNAL_API_KEY` (`crypto.timingSafeEqual`) en main-api.
- **Defensa en profundidad** de rate limiting, `helmet()`, límite de body, `trust proxy: 1` correcto en las APIs Node.
- **Audit log** append-only que hashea payloads (SHA-256) en lugar de almacenar PII — apropiado para Ley 21.663.
- **Frontend Angular** sin `eval`/`document.write`; único `bypassSecurityTrustHtml` está correctamente escapado; `window.open` con `noopener,noreferrer`; ciclo de vida de token disciplinado; sin secretos en el bundle; `frontend-angular/nginx.conf` con HSTS, CSP, `frame-ancestors 'none'`, COOP/CORP, `server_tokens off` y `security.txt`.
- **Servicios Rust** sin `unsafe`, sin secretos hardcodeados, con validación de entrada (ftpconsumer valida fechas/horas/JSON estrictamente), límites de body y transacciones explícitas; imágenes Rust corren como `USER nobody`.
- **CI/CD** sin `pull_request_target` inseguro; clave SSH con `chmod 600` y `ssh-keyscan` (no `StrictHostKeyChecking=no`); deploy gateado por presencia de secretos.
- **`.env.example`** con placeholders `CHANGE_ME`; `.env` y `**/.env` correctamente en `.gitignore` y `.dockerignore`; el harness de auditoría confirmó que el acceso a `.env` está bloqueado.
- **Esquema de BD** con diseño consciente de seguridad: columnas de lockout, OTP hash + expiry, contraseñas hasheadas, FKs con `ON DELETE` sensatos.

---

## 10. Hoja de ruta de remediación priorizada

> **Estado al 14/06/2026:** buena parte de la Fase 1 (control de acceso, endpoints, lockout/OTP, puertos, gate de deploy) ya está **cerrada en código** — ver **§1bis** para el detalle por hallazgo. La **Fase 0 sigue pendiente** porque requiere acción manual (rotación de secretos + purga de historia).

### Fase 0 — Inmediata (contención, < 48 h)
1. **Rotar TODOS los secretos filtrados** (EMT-C04): `JWT_SECRET`, `DGA_ENCRYPTION_KEY`, `RESEND_API_KEY`, `INTERNAL_API_KEY`, contraseñas de BD.
2. **Corregir el binding de puertos** (EMT-H03): quitar la exposición a `0.0.0.0` de BD, gRPC y `linux-db-api`; mover APIs a `127.0.0.1`. Verificar firewall/NSG de la VM.
3. **Quitar credenciales hardcodeadas** de `infra-db/docker-compose.yml` (EMT-H04) y rotarlas.

### Fase 1 — Crítica (esta semana)
4. **Control de acceso multi-tenant** en `/api/data/*` y handlers gRPC (EMT-C01, EMT-H01).
5. **Validar `?siteIds`** por elemento en cold-room (EMT-C02).
6. **Añadir `protect`/roles** a `statusRoutes`, `catalogRoutes` (esp. `POST /api/devices`), `metricsRoutes` (EMT-C03).
7. **Fail-closed** en `linux-db-api` y autenticación en la ingesta gRPC (EMT-H01, EMT-H02).
8. **Purgar `.env` y el CSV de la historia** de Git (EMT-C04, EMT-C05) + `git rm --cached` + `.gitignore`.

### Fase 2 — Alta (próximas 2 semanas)
9. Validar `sitio_id` y hacer explícito el scoping por sub-empresa (EMT-H05, EMT-H07).
10. Corregir constraints de rol/sub-empresa en `createUser` (EMT-H06).
11. Endurecer lockout y ventana de OTP; respuesta uniforme anti-enumeración (EMT-H08, EMT-H09, EMT-H10).
12. Gatear el deploy a producción con aprobación; consolidar workflows (EMT-H12).

### Fase 3 — Endurecimiento (próximo mes)
13. Headers + TLS en el Nginx de borde, rol de mínimo privilegio en BD, contenedores no-root, TLS interno, imágenes fijadas, ledger de migraciones, CSP sin `unsafe-inline`, evaluación de cookies httpOnly (EMT-M01..M12).
14. Integrar `pnpm audit` / `cargo audit` / escaneo de imágenes en CI; Dependabot/Renovate.
15. Resolver los hallazgos bajos/informativos.

---

## 11. Anexos

### 11.1 Herramientas y técnicas
- Revisión manual de código fuente (SAST) servicio por servicio.
- `pnpm audit` / `npm audit` (Node), inspección de `Cargo.lock`/`Cargo.toml` (Rust).
- Inspección de historia de Git (`git show`, `git log --all -S`, `git ls-files`).
- Verificación adversaria independiente de los 5 hallazgos críticos (intento activo de refutación).

### 11.2 Limitaciones
- `cargo-audit` no estaba instalado en el entorno de auditoría; el análisis de dependencias Rust fue por inspección manual de lockfiles. Se recomienda ejecutar `cargo audit` en CI para cobertura continua.
- Auditoría de código estático y de configuración; **no** incluyó pruebas de penetración dinámicas (DAST) sobre un entorno desplegado, ni revisión de la VM/red en ejecución. Se recomienda un pentest dinámico tras remediar los críticos.
- Los valores de secretos se mantuvieron redactados; las severidades EMT-C04/EMT-C05 dependen de la visibilidad real del repositorio, que debe confirmarse.

### 11.3 Mapeo OWASP Top 10 2021 (cobertura)

| Categoría | Hallazgos asociados |
|-----------|---------------------|
| A01 Broken Access Control | C01, C02, C03, C05, H02, H05, H06, H07, L05 |
| A02 Cryptographic Failures | C04, M02, M03, M06 |
| A03 Injection | L09 (sin SQLi — ver §9) |
| A04 Insecure Design | C05, M07, L06 |
| A05 Security Misconfiguration | H03, H04, M01, M03, M04, M05, M08, M09, L01, L02, L04, L08 |
| A06 Vulnerable Components | M13 |
| A07 Identification & Auth Failures | C03, C04, H02, H04, H08, H09, H10, H11 |
| A08 Software & Data Integrity | H12, M09, M10, M11, L03, L06 |
| A09 Logging & Monitoring | M08 |
| A10 SSRF | No se identificaron vectores (llamadas a hosts fijos de entorno) |

---

*Fin del informe.*
