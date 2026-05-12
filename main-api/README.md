# 🖥️ main-api — Backend REST API

Servidor backend construido con **Node.js + Express 5 + TypeScript** que maneja toda la lógica de negocio: autenticación, gestión de usuarios, datos de telemetría y envío de correos.

> Estado: refactor en curso a TypeScript + módulos. Endpoints `/api/*` (v1) siguen vivos para compatibilidad con el frontend. Los nuevos endpoints viven bajo `/api/v2/*` y se construyen a partir de `src/modules/<bounded-context>/{repo,service,controller,schema}.ts`.

## 🏗️ Arquitectura (v2 — TypeScript)

```
src/
├── config/        env.ts (zod), db.ts (statement_timeout + slow-log + prom-client),
│                  redis.ts (fallback degradado si no hay REDIS_URL), logger.ts (pino),
│                  metrics.ts (prom-client registry)
├── shared/        errors.ts (AppError, ValidationError, …), httpEnvelope.ts (ok/paginated/err),
│                  permissions.ts (canReadSite, requireSuperAdmin, scopeByTenant),
│                  time.ts, pagination.ts, requestContext.ts (AsyncLocalStorage + request-id)
├── middlewares/   auth.ts (JWT protect), error.ts (AppError → JSON), requestId.ts,
│                  httpMetrics.ts
├── http/v2/       routes.ts — router montado en /api/v2 desde src/app.js
├── modules/
│   ├── telemetry/  repo + service + controller + transforms + schema. Caché Redis online.
│   ├── sites/      repo + service + controller + transforms + types. Dashboard data/history.
│   ├── companies/  repo + service + controller. Árbol jerárquico empresa→sub→sitio.
│   ├── auth/       repo (OTP en Redis dual-write) + service + controller. Login + requestCode.
│   ├── alerts/     worker.ts — polling de alertas, controlado por ENABLE_ALERTS_WORKER.
│   ├── metrics/    buffer.ts (in-memory) + flusher.ts (batch upsert cada 5 s).
│   └── health/     liveness, readiness (DB+Redis), /metrics Prometheus.
└── server.js / app.js  (legacy entry — montan routers v1 + cargan dist/http/v2 si existe)
```

**Reglas:** controllers no importan repos directamente — sólo services. Repos sólo consultan DB. Schemas zod son la fuente de verdad para validación + tipos derivados.

## 📊 Optimizaciones de performance

- Prepared statements en queries calientes (`pool.query({ name, text, values })`).
- Caché Redis para `/telemetry/online` (TTL 5 s); degradación a noop si `REDIS_URL` ausente.
- Buffer in-memory + flusher batch para `api_metrics` (elimina UPSERT por request).
- `time_bucket('1 minute', time)` de TimescaleDB en dashboard-history.
- `statement_timeout` por conexión (default 10 s) + slow-log a pino para queries > 500 ms.
- Migración `003_telemetry_perf_indices.js`: índice `equipo(id_serial, time DESC)` + GIN sobre `data`.
- Histograma Prometheus de duración HTTP/DB en `/api/v2/metrics` (protegido con `INTERNAL_API_KEY`).

## 🔁 Cómo migrar el frontend a v2

1. Para cada endpoint legacy de `/api/data/*` o `/api/companies/sites/:id/dashboard-*`, hay equivalente en `/api/v2/telemetry/*` y `/api/v2/sites/:id/dashboard-*`.
2. Respuesta v2 sigue envelope `{ ok: true, data, meta }`. Errores: `{ ok: false, error: { code, message, requestId } }`.
3. v1 sigue funcionando — migrar módulo por módulo con flag de feature.

---

## 🚀 Cómo arrancar

```bash
# 1. Instalar dependencias
npm install

# 2. Crear archivo de variables de entorno
cp .env.example .env
# ⚠️ Edita .env con tus credenciales reales de BD y correo

# 3. Sembrar usuarios iniciales (solo la primera vez)
node src/seed_auth.js

# 4. Iniciar el servidor
npm start

# O con auto-recarga en desarrollo:
npm run dev
```

El servidor quedará en: `http://localhost:3000`

---

## 📂 Estructura del Proyecto

```
main-api/
├── .env.example                 → Plantilla de variables de entorno
├── package.json                 → Dependencias y scripts
├── Dockerfile                   → Para despliegue en contenedores
├── docker-compose.yml           → Orquestación con la BD
└── src/
    ├── server.js                → Punto de entrada (levanta HTTP + gRPC)
    ├── app.js                   → Configuración de Express (middlewares, rutas)
    ├── seed_auth.js             → Script para crear usuarios iniciales de prueba
    ├── config/
    │   └── db.js                → Pool de conexión a PostgreSQL/TimescaleDB
    ├── controllers/
    │   ├── authController.js    → Login y generación de códigos OTP
    │   ├── userController.js    → Creación de usuarios y listado de empresas
    │   ├── dataController.js    → Lectura de datos de telemetría
    │   ├── catalogController.js → Catálogos (empresas, equipos)
    │   └── metricsController.js → Métricas calculadas
    ├── middlewares/
    │   ├── authMiddleware.js    → Verificación JWT + autorización por roles
    │   └── errorMiddleware.js   → Manejo centralizado de errores
    ├── routes/
    │   ├── authRoutes.js        → POST /api/auth/login, /api/auth/request-code
    │   ├── userRoutes.js        → POST /api/users, GET /api/users/empresas
    │   ├── dataRoutes.js        → GET /api/data/latest, /api/data/preset
    │   ├── catalogRoutes.js     → GET /api/empresas, /api/equipos
    │   ├── healthRoutes.js      → GET /api/health
    │   └── metricsRoutes.js     → GET /api/metrics/*
    ├── services/
    │   └── emailService.js      → Nodemailer (Gmail SMTP o Ethereal para pruebas)
    └── grpc/
        └── ...                  → Servidor gRPC para recibir datos del pipeline Go
```

---

## 🔑 Variables de Entorno (.env)

| Variable      | Descripción                 | Ejemplo               |
| ------------- | --------------------------- | --------------------- |
| `DB_HOST`     | Host de la base de datos    | `localhost`           |
| `DB_PORT`     | Puerto de TimescaleDB       | `5433`                |
| `DB_NAME`     | Nombre de la base de datos  | `db_infra`            |
| `DB_USER`     | Usuario de PostgreSQL       | `admin_infra`         |
| `DB_PASSWORD` | Contraseña de PostgreSQL    | `MiClave123`          |
| `PORT`        | Puerto del servidor HTTP    | `3000`                |
| `SMTP_HOST`   | Servidor SMTP de correo     | `smtp.gmail.com`      |
| `SMTP_PORT`   | Puerto SMTP (465=SSL)       | `465`                 |
| `SMTP_USER`   | Correo remitente            | `alertas@empresa.com` |
| `SMTP_PASS`   | Contraseña de App de Google | `xxxx xxxx xxxx xxxx` |

---

## 🌐 Endpoints de la API

### Autenticación (Público)

| Método | Ruta                     | Descripción                              |
| ------ | ------------------------ | ---------------------------------------- |
| `POST` | `/api/auth/login`        | Iniciar sesión con email + código OTP    |
| `POST` | `/api/auth/request-code` | Solicitar código de 6 dígitos por correo |

### Usuarios (Protegido — Admin/SuperAdmin)

| Método | Ruta                  | Descripción                                |
| ------ | --------------------- | ------------------------------------------ |
| `POST` | `/api/users`          | Crear un nuevo usuario (sin enviar correo) |
| `GET`  | `/api/users/empresas` | Listar empresas y sub-empresas disponibles |

### Datos de Telemetría (Protegido)

| Método | Ruta                          | Descripción                           |
| ------ | ----------------------------- | ------------------------------------- |
| `GET`  | `/api/data/latest`            | Última lectura de todos los sensores  |
| `GET`  | `/api/data/preset?preset=24h` | Datos por rango de tiempo predefinido |

### Salud del Sistema

| Método | Ruta          | Descripción                         |
| ------ | ------------- | ----------------------------------- |
| `GET`  | `/api/health` | Estado del servidor y conexión a BD |

---

## 📧 Sistema de Correos (Nodemailer)

El servicio de correos (`src/services/emailService.js`) funciona en dos modos:

1. **Modo Producción (Gmail):** Si las variables `SMTP_HOST`, `SMTP_USER` y `SMTP_PASS` existen en `.env`, se conecta directamente a Gmail vía SSL (puerto 465) y envía correos reales.

2. **Modo Desarrollo (Ethereal):** Si NO existen esas variables, crea automáticamente una cuenta temporal en [Ethereal](https://ethereal.email) y los correos se pueden visualizar via URL en la consola del servidor.

### Configurar Gmail para envío real

1. Accede a tu cuenta de Google → Seguridad → Verificación en 2 pasos (activar).
2. Ve a [Contraseñas de Aplicaciones](https://myaccount.google.com/apppasswords).
3. Crea una app llamada "Panel Industrial" → Copia las 16 letras generadas.
4. Pégalas en `SMTP_PASS` de tu `.env` (sin espacios).

---

## 🔒 Seguridad

- **bcrypt** (salt rounds: 10) para hashear todos los códigos OTP.
- **JWT** con expiración de 12 horas para las sesiones.
- **Helmet** para cabeceras HTTP seguras.
- **Rate Limiting** global (200 solicitudes cada 15 minutos).
- **CORS** configurable por variable de entorno.
- Middleware de **autorización por roles** (`protect` + `authorizeRoles`).
