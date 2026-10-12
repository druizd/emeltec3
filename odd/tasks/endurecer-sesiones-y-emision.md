# Endurecer sesiones y emisión de "ver como"

## Objetivo

Cerrar los huecos que quedaron fuera de alcance en
`odd/tasks/endurecer-ver-como.md`: tokens de propósito aceptados por `protect`,
emisión de "ver como" basada en el `tipo` del JWT, sesiones que sobreviven a un
cambio de rol o a la desactivación, y login de usuarios inactivos.

## Problema

- Los dos `protect` (`main-api/src/middlewares/auth.ts` y
  `main-api/src/middlewares/authMiddleware.js`) aceptan cualquier JWT firmado,
  incluidos los tokens de propósito (`purpose`) y tokens sin `id` o `tipo`.
- `issueViewAsToken` (`main-api/src/modules/auth/service.ts:126`) valida
  `actor.tipo` desde el token, no desde la tabla `usuario`: un SuperAdmin
  degradado o desactivado puede seguir emitiendo tokens "ver como" mientras su
  sesión viva.
- `updateUser` y `deleteUser` (`main-api/src/controllers/userController.js`)
  cambian el `tipo` o desactivan sin escribir `sessions_valid_from`, así que las
  sesiones abiertas conservan el rol anterior.
- El login de main-api (v1 `controllers/authController.js` y v2
  `modules/auth/service.ts`) no rechaza a usuarios con `activo = false`.

## Alcance autorizado (usuario, 2026-10-12)

- T1: los dos `protect` responden 401 a todo token con `purpose` o sin `id` o
  `tipo`. Las sesiones ya emitidas y los tokens "ver como" siguen pasando.
- T2: `issueViewAsToken` lee `tipo` y `activo` reales del emisor con una función
  nueva en `modules/auth/repo.ts`; 403 si no es SuperAdmin activo; si la
  consulta falla, no emite.
- T3: `updateUser` y `deleteUser` escriben `sessions_valid_from = NOW()` cuando
  cambia el `tipo` o el usuario pasa a inactivo.
- T4: el login v1 y v2 rechaza `activo = false` con la misma respuesta que
  credenciales inválidas.

## Criterios de aceptación

- Un token con `purpose`, o sin `id` o sin `tipo`, recibe 401 en v1 y v2; una
  sesión normal y un token "ver como" vigentes siguen pasando.
- Un emisor cuyo registro en `usuario` no es SuperAdmin activo recibe 403; si
  la consulta falla, no se emite token.
- Cambiar el `tipo` o desactivar un usuario revoca sus sesiones y sus tokens
  "ver como"; editar otros campos no.
- Un usuario inactivo no puede iniciar sesión en v1 ni en v2, y la respuesta es
  indistinguible de credenciales inválidas.

## Modo TDD

No configurado en el proyecto (mismo criterio que
`odd/tasks/endurecer-ver-como.md`). Se sigue la convención de registrar RED
antes de GREEN. Runner: vitest (`cd main-api && npm test`, más
`npm run typecheck`).

## Checks de cierre

Pasos del CI en local antes de publicar: lint, format:check, typecheck, tests y
build (main-api).

## Tareas

- [x] T1 — `protect` v1 y v2 rechazan tokens de propósito o incompletos.
- [x] T2 — `issueViewAsToken` valida tipo y activo contra la base.
- [x] T3 — `updateUser`/`deleteUser` revocan sesiones al cambiar rol o
      desactivar.
- [x] T4 — Login v1 y v2 rechaza usuarios inactivos.

## Ruta por tarea

- T1–T4: delegada (writer único; cada tarea toca código y tests en 2 o más
  archivos no triviales).

## Entrega

- Pronóstico: unas 350–450 líneas de autoría (tests incluidos).
- Estrategia: `ask-on-risk`; si se superan unas 400 líneas se pregunta cómo
  entregarlo antes de publicar.
- Real: unas 720 líneas de autoría (≈610 de código y tests). Estrategia de
  cadena elegida por el usuario (2026-10-12): `feature-branch-chain`.
- Tracker: `feat/endurecer-sesiones-y-emision` (desde `origin/main` `5a28e2d`),
  PR borrador a `main` que se mergea solo con la cadena completa.
- Slices (cada uno apunta a la rama anterior):
  1. `feat/endurecer-sesiones-y-emision-01-protect` — T1.
  2. `feat/endurecer-sesiones-y-emision-02-emisor` — T2.
  3. `feat/endurecer-sesiones-y-emision-03-revocacion` — T3.
  4. `feat/endurecer-sesiones-y-emision-04-login-inactivo` — T4.
- El documento vive en la tracker; los slices llevan solo código y tests. Los
  commits de T1–T4 citados abajo son los de la rama de trabajo original
  (`feat/endurecer-ver-como-04-sesiones-y-emision`); en la cadena se
  re-aplicaron uno por slice, con el ajuste de tipos y lint de `8bc19a3`
  dentro del slice al que pertenece cada test.

## Progreso

- T1 a T4 hechas y checks de cierre en verde. Pendiente: revisión nativa por
  slice (`gentle-ai review assess` sobre la rama completa: riesgo `high`,
  `hot_path` en `middlewares/auth.ts`) y merge de la cadena.
- Commits: T1 `d119434`, T2 `782f070`, T3 `929d6f4`, T4 `92723a7`, ajuste de
  tipos/lint de tests `8bc19a3`.
- Checks de cierre (main-api): `npm run lint` 0 problemas;
  `npx tsc -p tsconfig.test.json --noEmit` exit 0; prettier sobre el contenido
  commiteado OK en los 13 archivos; `npm test` 89 archivos / 986 tests;
  `npm run build` exit 0. Re-ejecución de control: los 5 archivos de tests
  nuevos o tocados, 52/52.

## Evidencia

### T1

- Tokens firmados hoy: sesión main-api v1 y v2 y auth-api `makeAuthToken`
  (`id`, `email`, `tipo`, `empresa_id`, `sub_empresa_id`); token de
  cambio de contraseña de perfil (`id`, `email`, `tipo`, ...); "ver como"
  (`id`=`view-as`, `tipo`=rol, `act_as`, `real_sub`); propósito de
  auth-api: `{email, purpose: mfa|account_setup|password_reset}` sin `id` ni
  `tipo`. Ninguna sesión legítima carece de `id` o `tipo`.
- RED: `protectTokensDeProposito.test.ts` 12 fallos (200 en lugar de 401), 4
  pasan (sesión normal y "ver como" en v1 y v2).
- GREEN: 16/16 tras el cambio en ambos `protect`.

### T2

- Función nueva `findUserTipoActivoById` en `modules/auth/repo.ts`.
- RED: `viewAs.test.ts` 4 fallos (degradado, desactivado, inexistente y
  consulta caída emitían token); 17 pasaban.
- GREEN: 21/21 en `modules/auth`; `http/v2` 37/37 tras ajustar el mock de
  `dbHelpers.query` en `auditoria-escrituras.test.ts` para devolver el
  SuperAdmin real.

### T3

- RED: `userController.revocacion.test.ts` 3 fallos (cambio de tipo,
  `activo=false` y `deleteUser` no escribían `sessions_valid_from`); 3 pasan
  (mismo tipo, reactivar y otros campos no revocan).
- GREEN: 6/6; `src/controllers` 57/57.
- Caché de revocación: `services/sessionRevocation.js` guarda el corte 30 s
  (`SESSION_REVOCATION_TTL_MS`) por proceso; se llama `forget(id)` tras
  escribir, así que en el mismo proceso es inmediato, pero otra réplica tarda
  hasta 30 s en verlo.

### T4

- RED: `loginInactivo.test.ts` (v2) y `authController.inactivo.test.ts` (v1):
  4 fallos (inactivo con clave u OTP correctos recibía token / 200).
- GREEN: 103/103 en `modules/auth`, `controllers` y `http`.
- La comprobación va después de las verificaciones bcrypt/OTP, así que el costo
  y la respuesta (401, "Credenciales inválidas") son los de credenciales
  inválidas. Un OTP correcto de un inactivo se consume igual (inocuo).
- Hueco fuera de alcance: auth-api tiene su propio login (ver reporte).
