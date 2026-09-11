# auth-api — Arquitectura

Servicio de autenticación de Emeltec Cloud. Node.js + Express 5, CommonJS. Puerto 3001. Stateless — solo JWT, sin sesiones.

---

## Arranque

```
src/server.js     ← Entry point (listen port 3001)
  └── src/app.js  ← Express: middleware, rate-limit, rutas
```

Sin workers. Puro request-response.

---

## Rutas

Base: `/api/auth`

| Método | Ruta                         | Rate limit     | Qué hace                                            |
| ------ | ---------------------------- | -------------- | --------------------------------------------------- |
| POST   | `/api/auth/start`            | 30/min global  | Inicia login, detecta estado cuenta → devuelve flow |
| POST   | `/api/auth/setup/start`      | 30/min global  | Activa cuenta nueva, envía OTP                      |
| POST   | `/api/auth/setup/complete`   | 30/min global  | Completa activación con OTP + password              |
| POST   | `/api/auth/recover/start`    | 5/min estricto | Inicia reset de contraseña, envía OTP               |
| POST   | `/api/auth/recover/complete` | 5/min estricto | Aplica la nueva contraseña con OTP                  |
| POST   | `/api/auth/login`            | 5/min estricto | Valida credenciales → JWT o challenge MFA           |
| POST   | `/api/auth/request-code`     | 5/min estricto | Solicita nuevo OTP manualmente                      |
| GET    | `/api/health`                | Sin límite     | Liveness + test SELECT NOW() a DB                   |

---

## Flujos de autenticación

### 1. Password (`auth_mode = 'password'`)

```
POST /start          → { flow: 'password' }
POST /login          → JWT 1h
```

### 2. Password + MFA (`auth_mode = 'password_otp'`)

```
POST /start          → { flow: 'password' }
POST /login          → challenge_token (10min) + OTP por email
POST /login (mode=mfa, otp_code, challenge_token) → JWT 1h
```

### 3. OTP puro (`auth_mode = 'otp'`)

```
POST /start          → OTP enviado + { flow: 'otp', expires_at }
POST /login          → JWT 1h
```

### 4. Activación de cuenta nueva

```
POST /setup/start    → setup_token (10min) + OTP por email
POST /setup/complete → activa cuenta, setea password, JWT 1h
```

### 5. Recuperación de contraseña

```
POST /recover/start    → reset_token (10min) + OTP por email (purpose=password_reset)
POST /recover/complete → setea password, corta sesiones, SIN JWT (vuelve a /login)
```

Solo aplica a cuentas activadas, activas, no bloqueadas y con `auth_mode` que
permita contraseña (`password` / `password_otp`). El `auth_mode` no se modifica:
una cuenta con MFA conserva su segundo factor y debe usarlo al ingresar — por eso
`/recover/complete` no emite JWT.

Anti-enumeración: `/recover/start` responde siempre igual (200 + `reset_token`)
exista o no la cuenta; si el correo no corresponde a una cuenta elegible, no se
envía OTP y `/recover/complete` falla con el 401 genérico de código inválido.

Sin OTP pendiente, `/recover/complete` **no** cuenta el intento contra el lockout:
como el `reset_token` se entrega para cualquier correo, contarlo permitía bloquear
a voluntad una cuenta conocida mandando códigos al azar.

Al completarse se setea `sessions_valid_from = NOW()` (cierra las sesiones
abiertas con la contraseña anterior) y se dispara el aviso "tu contraseña fue
cambiada" vía `POST {MAIN_API_URL}/api/internal/email/password-changed`.

---

## Tokens JWT (HS256, `JWT_SECRET` compartido con main-api)

| Tipo          | TTL   | Claims                                        |
| ------------- | ----- | --------------------------------------------- |
| Auth token    | 1h    | `id, email, tipo, empresa_id, sub_empresa_id` |
| Challenge MFA | 10min | `{ email, purpose: 'mfa' }`                   |
| Setup token   | 10min | `{ email, purpose: 'account_setup' }`         |
| Reset token   | 10min | `{ email, purpose: 'password_reset' }`        |

Sin refresh tokens. Expirado → re-login. La duración del auth token es fija: `1h`. El frontend lee el claim `exp`, muestra un aviso 31 segundos antes y cierra sesión automáticamente al expirar. No hay renovación silenciosa por actividad.

**Revocación.** No hay `jti` ni denylist, pero un cambio de contraseña sí corta
las sesiones: setea `usuario.sessions_valid_from` y main-api rechaza todo token
cuyo `iat` sea de un segundo anterior a ese corte
(`main-api/src/services/sessionRevocation.js`). La propagación tarda hasta
`SESSION_REVOCATION_TTL_MS` (30 s por defecto) por el cache en proceso.

---

## Seguridad

| Mecanismo            | Detalle                                                               |
| -------------------- | --------------------------------------------------------------------- |
| Rate limit global    | 30 req/min por IP en `/api/auth`                                      |
| Rate limit login/OTP | 5 req/min por IP                                                      |
| Lockout por cuenta   | 5 fallos → bloqueo 1 min, registrado en audit_log                     |
| OTP hash             | bcrypt cost=12, expiry 30min                                          |
| Password hash        | bcrypt cost=12                                                        |
| Política de password | `services/passwordPolicy.js`: ≥8 chars, fuerza ≥3, nunca solo dígitos |
| Corte de sesiones    | `usuario.sessions_valid_from` vs claim `iat`                          |
| Audit log            | Toda acción auth → tabla `audit_log` (Ley 21.663)                     |

---

## Base de datos

Misma DB que main-api: **TimescaleDB** `telemetry_platform`.

### Tabla `usuario` (campos relevantes auth)

| Campo                       | Tipo        | Descripción                         |
| --------------------------- | ----------- | ----------------------------------- |
| `id`                        | uuid        | PK                                  |
| `email`                     | text        | UNIQUE, login principal             |
| `password_hash`             | text        | bcrypt                              |
| `otp_hash`                  | text        | bcrypt del OTP activo               |
| `otp_expires_at`            | timestamptz | Expiración OTP                      |
| `auth_mode`                 | enum        | `password` / `otp` / `password_otp` |
| `failed_logins`             | int         | Contador fallos consecutivos        |
| `locked_until`              | timestamptz | Bloqueo temporal                    |
| `last_login_at`             | timestamptz | Último login exitoso                |
| `last_login_ip`             | text        | IP último login                     |
| `otp_requests_count`        | int         | Rate limit OTPs                     |
| `otp_requests_window_start` | timestamptz | Ventana rate limit OTP              |
| `activated_at`              | timestamptz | NULL = cuenta sin activar           |
| `sessions_valid_from`       | timestamptz | Corte de sesiones; NULL = sin corte |
| `tipo`                      | text        | Rol: SuperAdmin/Admin/Empresa/etc.  |
| `empresa_id`                | uuid FK     | Tenant empresa                      |
| `sub_empresa_id`            | uuid FK     | Tenant sub-empresa                  |

### Tabla `audit_log`

Registro append-only de todas las acciones auth. Campos: `actor_id`, `actor_email`, `action`, `target_type`, `target_id`, `ip`, `user_agent`, `status_code`, `payload_hash` (SHA256, sin PII), `ts`, `metadata` JSONB.

---

## Integración externa

**Solo una:** llamadas HTTP internas a main-api para enviar correos.

```
POST {MAIN_API_URL}/api/internal/email/otp
Headers: X-Internal-Key: {INTERNAL_API_KEY}
Body: { email, nombre, code, minutes, purpose }

POST {MAIN_API_URL}/api/internal/email/password-changed
Headers: X-Internal-Key: {INTERNAL_API_KEY}
Body: { email, nombre, origen, ip, ts }
```

`purpose` elige la plantilla: `acceso` (login, MFA, activación) o
`password_reset`. Sin él, quien pedía recuperar su contraseña recibía el correo
de "código de acceso", con la nota de seguridad apuntando al evento equivocado.

auth-api no envía emails directamente — delega a main-api que usa Resend.

---

## Variables de entorno

| Variable           | Requerida | Default                | Qué hace                                |
| ------------------ | --------- | ---------------------- | --------------------------------------- |
| `JWT_SECRET`       | ✅        | —                      | Firma JWT — debe coincidir con main-api |
| `INTERNAL_API_KEY` | ✅        | —                      | Auth para llamar a main-api             |
| `NODE_ENV`         | ❌        | `production`           | Verbosidad errores                      |
| `PORT`             | ❌        | `3001`                 | Puerto HTTP                             |
| `MAIN_API_URL`     | ❌        | `http://main-api:3000` | URL para envío de emails OTP            |
| `DB_HOST`          | ❌        | `timescaledb`          | PostgreSQL host                         |
| `DB_PORT`          | ❌        | `5432`                 | PostgreSQL port                         |
| `DB_NAME`          | ❌        | `telemetry_platform`   | Nombre DB                               |
| `DB_USER`          | ❌        | `postgres`             | Usuario DB                              |
| `DB_PASSWORD`      | ❌        | —                      | Password DB                             |

> `JWT_SECRET` e `INTERNAL_API_KEY` deben ser idénticos en auth-api y main-api.

---

## Stack técnico

| Capa       | Tecnología                |
| ---------- | ------------------------- |
| Runtime    | Node.js 24+               |
| HTTP       | Express 5                 |
| Lenguaje   | CommonJS (sin TypeScript) |
| DB driver  | `pg` v8                   |
| Tokens     | `jsonwebtoken` HS256      |
| Hashing    | `bcrypt` cost=12          |
| Seguridad  | Helmet, CORS, rate-limit  |
| Logging    | Morgan                    |
| Compliance | Ley 21.663 (audit_log)    |

---

## Relación con main-api

```
auth-api                    main-api
   │                            │
   ├── Comparte JWT_SECRET ──────┤
   ├── Comparte DB ─────────────┤
   └── POST /internal/email ────┤ (envío OTP)

Frontend → auth-api (login) → JWT → main-api (todos los demás endpoints)
```
