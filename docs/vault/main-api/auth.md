# Autenticación y Permisos

---

## Roles de usuario

Definidos en `shared/src/user.ts` (frontend) y `main-api/src/shared/permissions.ts` (backend).

| Rol          | Acceso                                                                           |
| ------------ | -------------------------------------------------------------------------------- |
| `SuperAdmin` | Todo. Sin filtro de empresa                                                      |
| `Admin`      | Su empresa completa. Puede crear usuarios en su empresa                          |
| `Gerente`    | Su empresa. Si tiene `sub_empresa_id` → solo esa sub_empresa                     |
| `Cliente`    | Su empresa (lectura). Sin gestión de usuarios                                    |
| `Vendedor`   | Su empresa (lectura). Sin gestión de usuarios                                    |
| `Empresa`    | Solo backend: acceso a empresa completa (sinónimo de Admin en algunos contextos) |
| `SubEmpresa` | Solo backend: acceso limitado a su sub_empresa                                   |

> **Nota:** `Empresa` y `SubEmpresa` están en `permissions.ts` pero NO en `shared/user.ts`. Divergencia histórica.

---

## Modos de autenticación (`auth_mode`)

| Modo           | Descripción                     |
| -------------- | ------------------------------- |
| `password`     | Solo contraseña                 |
| `otp`          | Solo OTP por email              |
| `password_otp` | Contraseña + OTP (2FA completo) |

---

## Flujo de autenticación

```
POST /auth/login
  → valida credenciales (bcrypt)
  → si auth_mode incluye otp → envía OTP por email
  → si no → devuelve JWT

POST /auth/verify-otp
  → valida OTP (hash en DB, expira en 24h)
  → devuelve JWT

JWT en header: Authorization: Bearer <token>
  → authMiddleware.js valida y agrega req.user

Refresh: POST /auth/refresh (token de corta duración)
```

---

## Control de acceso por sitio

`canReadSite(user, site)` en `permissions.ts`:

```
SuperAdmin           → siempre true
Admin / Empresa      → empresa_id del user = empresa_id del sitio
Gerente / Cliente / Vendedor / SubEmpresa:
  → misma empresa Y
    (user.sub_empresa_id es null → acceso a toda la empresa*)
    O (user.sub_empresa_id = sitio.sub_empresa_id)
```

> \*Decisión jun-2026: usuario sin sub_empresa asignada ve toda la empresa.

---

## `scopeByTenant(user)`

Devuelve `{ empresaIds: string[]|null, subEmpresaIds: string[]|null }`.
`null` = sin filtro (SuperAdmin).

Usado en queries para filtrar por tenant sin repetir la lógica en cada controlador.

---

## Step-up 2FA (acciones sensibles)

Algunas acciones requieren verificación adicional independiente del `auth_mode`:

- Cambiar `dga_transport` a `'rest'`
- Reset de contraseña de otro usuario

Flujo: `POST /2fa/step-up` → genera token temporal con scope limitado → acción usa ese token.

Implementación: `shared/stepUp2fa.js` + `routes/twoFactorRoutes.js` + `modules/dga/twofactor.ts`

---

## Gestión de usuarios (`userController.js`)

| Acción                 | Quién puede                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Crear usuario          | Admin (en su empresa), Gerente (en su sub_empresa), SuperAdmin (en cualquier parte) |
| Editar usuario         | Misma jerarquía — no puede elevar rol propio ni de igual jerarquía                  |
| Eliminar usuario       | Soft-delete (`activo=false`). No puede autoeliminarse                               |
| Reset password         | Genera OTP 24h + email de bienvenida                                                |
| Ver todos los usuarios | SuperAdmin y Admin. Clientes → 403                                                  |

---

## Tabla `usuario`

| Columna              | Descripción                           |
| -------------------- | ------------------------------------- |
| `id`                 | varchar(10) PK generado como `U{hex}` |
| `nombre`, `apellido` |                                       |
| `email`              | UNIQUE, login                         |
| `rut_usuario`        | RUT (opcional)                        |
| `tipo`               | Rol (ver tabla arriba)                |
| `empresa_id`         | FK → empresa                          |
| `sub_empresa_id`     | FK → sub_empresa (opcional)           |
| `auth_mode`          | `password` / `otp` / `password_otp`   |
| `password_hash`      | bcrypt                                |
| `activo`             | Soft-delete                           |
| `last_login_at`      |                                       |
| `activated_at`       | Cuando activó la cuenta               |

---

## Ver también

- [[overview]] — estructura general de main-api
- [[../db/empresa-sitio]] — jerarquía empresa → sub_empresa → sitio
