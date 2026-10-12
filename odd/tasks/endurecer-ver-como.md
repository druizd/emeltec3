# Endurecer "ver como" y escrituras sin control de rol

## Objetivo

Cerrar tres huecos confirmados después de desplegar `ver-como-servidor` (PR #264):
la revocación que falla abierta para tokens "ver como", la falta de control de
rol en `PUT operacion-config` y las escrituras v2 bloqueadas que no quedan en
`audit_log`.

## Problema

- `services/sessionRevocation.js:68-81` devuelve `false` (no revocado) si la
  consulta a la base falla; `middlewares/auth.ts:80-88` además tiene un
  `.catch(attach)`. Un token "ver como" revocado sigue sirviendo si la base
  falla.
- `PUT /api/companies/sites/:siteId/operacion-config` solo exige
  `requireSiteAccess`: Cliente, Gerente y Vendedor (maletas piloto) pueden
  cambiar turnos y jornada.
- En v2 la auditoría se monta por ruta y después de `protect`, y las rutas de
  bitácora no la tienen. Verificado en producción el 2026-10-12:
  `PATCH /api/v2/sites/bitacora/equipos/EQ999999` con token "ver como"
  responde 403 pero no deja fila en `audit_log`; la misma prueba en v1
  (`PUT /api/alertas/999999999`) sí queda registrada con `impersonator_id`.
- `middlewares/__tests__/actAsAudit.test.ts` monta la auditoría antes de
  `protect` "como en app.js", algo que solo es cierto en v1.

## Alcance autorizado

- Revocación: fallar cerrado solo para tokens "ver como" (`act_as`), en los dos
  `protect`. Los tokens normales mantienen el comportamiento actual para que un
  corte de la base no cierre todas las sesiones.
- `PUT operacion-config`: solo `SuperAdmin` y `Admin` (decisión del usuario,
  2026-10-12). El GET sigue igual.
- Frontend: deshabilitar la edición de turnos y jornada para roles sin permiso,
  para que no disparen el guardado automático y reciban un 403.
- Auditoría v2: registrar las escrituras v2 (incluidas las rechazadas por
  `protect`) sin duplicar las filas de las rutas DGA y digest que ya auditan.

Fuera de alcance (otro PR): GET no auditados, TTL de 12 h del login v2, `tipo`
del JWT en vez de la base al emitir, tokens de propósito aceptados por
`protect`, desajuste de alcance de Vendedor entre v1 y v2, rutas
`/sites/:siteId/variables` sin control de sitio.

## Criterios de aceptación

- Con la revocación fallando, un token "ver como" recibe 401 en v1 y v2; un
  token normal sigue pasando.
- `PUT operacion-config` responde 403 a Gerente, Cliente y Vendedor, y 200 a
  SuperAdmin y Admin.
- En la UI, Gerente, Cliente y Vendedor ven los turnos y la jornada sin poder
  editarlos.
- Una escritura v2 con token "ver como" rechazada por `protect` deja una fila en
  `audit_log` con `impersonator_id`; una escritura v2 auditada hoy sigue
  generando una sola fila.

## Modo TDD

No configurado en el proyecto (fuente: sin `strict_tdd` ni equivalente en
`CLAUDE.md`, `AGENTS.md` ni openspec; mismo criterio que
`odd/tasks/ver-como-servidor.md`). Se sigue la convención de registrar RED antes
de GREEN. Runner: vitest (`cd main-api && npm test`, más `npm run typecheck`);
frontend: `npm test` y build.

## Tareas

- [x] T1 — Revocación falla cerrada para tokens "ver como" (v1 y v2).
- [x] T2 — `PUT operacion-config` solo para SuperAdmin y Admin.
- [x] T3 — Frontend: edición de turnos y jornada solo para SuperAdmin y Admin.
- [x] T4 — Auditoría v2 antes de `protect`, sin filas duplicadas.

## Ruta por tarea

- T1–T4: delegada (writer único; toca 2 o más archivos no triviales por tarea).

## Entrega

- Pronóstico: unas 350–450 líneas de autoría (tests incluidos).
- Estrategia: `ask-on-risk`; si se superan unas 400 líneas se pregunta por la
  cadena antes del siguiente commit.
- Real: unas 1.215 líneas. Cadena elegida por el usuario (2026-10-12): PRs
  apilados sobre `main` (`stacked-to-main`), fusionados en orden.
  - PR 1 `feat/endurecer-ver-como-01-revocacion-rol`: 7e8a776, 8778140
    (T1, T2), 390 líneas.
  - PR 2 `feat/endurecer-ver-como-02-frontend`: 3ddc030 (T3), 153 líneas.
  - PR 3 `feat/endurecer-ver-como-03-auditoria-v2`: efdef21, e49d39b,
    e1a6474, fde410d y este registro (T4 y correcciones), unas 650 líneas.
    `size:exception`: el montaje en el router, los resolvers movidos y sus
    tests son una sola unidad (efdef21 solo son 517 líneas); separar las
    correcciones no lo deja bajo 400.
- Revisión nativa: `review-b0afbbf5a7e52de1` (f1de3df..e1a6474) y
  `review-97e3938a26874c2d` (e1a6474..fde410d), ambas aprobadas y acusadas.

## Progreso y evidencia

- Rama `feat/endurecer-ver-como` desde `origin/main` f1de3df, worktree
  `../emeltec3-endurecer`. Sin push.
- T1: RED 3 tests fallando (2 de protect con "ver como" + 1 unitario de
  `failClosed`) -> GREEN. `npm test` main-api: 83 archivos, 932 tests OK;
  `npm run typecheck` OK. Opción `{ failClosed }` en `isSessionRevoked`; v1
  responde 401 y v2 `next(UnauthorizedError)` solo si el token es act_as; los
  normales siguen fallando abiertos. Tests nuevos:
  `middlewares/__tests__/actAsRevocation.test.ts` (protect real v1 y v2).
  Commit: 7e8a776.
- T2: RED 2 tests fallando (PUT 200 en vez de 403 para Gerente y Cliente) ->
  GREEN. `npm test` main-api: 84 archivos, 938 tests OK; typecheck OK. Test:
  `routes/__tests__/companyRoutesOperacionConfig.test.ts` monta el router real
  de companyRoutes con tokens firmados y un stub del controller de dist (no hay
  build en test). Nota: Vendedor ya recibía 403 antes del cambio porque
  `requireSiteAccess` no le da alcance al sitio (desajuste v1/v2 de Vendedor,
  fuera de alcance); el test lo cubre igual. Commit: 8778140.
- T3: RED (el spec no compilaba sin `canEditConfig`; con la propiedad sola, 1
  test fallando: PUT disparado sin permiso) -> GREEN. Frontend `npm test`: 17
  archivos, 275 tests OK; `npm run build` OK (solo warnings previos de
  hammerjs). Rol efectivo: `AuthService.canEditSiteSettings` (ya existía; usa
  `effectiveRole`, que respeta "ver como"). `WaterOperacionStateService`
  expone `canEditConfig`; el effect de autoguardado y el loop del PUT salen sin
  disparar si es false, y los 3 componentes deshabilitan selector de turnos,
  nombre/inicio/fin y jornada. Spec nuevo: `water-operacion-state.spec.ts`.
  Dependencias: `npm ci` no aplica (workspace pnpm); se usó
  `npx pnpm@11.1.1 install --frozen-lockfile --filter ./frontend-angular...`
  sin tocar el lockfile. Commit: 3ddc030.
- T4: RED 2 tests fallando (PATCH bitácora con "ver como" y PUT digest con rol
  Cliente: 0 filas en audit_log); los 3 de regresión (DGA, digest, lecturas)
  pasaban antes y después -> GREEN. `npm test` main-api: 85 archivos, 943 tests
  OK; typecheck y eslint OK. Decisión: un único `router.use(auditMutations(
  resolveV2Audit))` al inicio de `http/v2/routes.ts` (tras las rutas públicas de
  login) y resolvers movidos a `http/v2/auditResolver.ts`; se quitó el audit por
  ruta. Se eligió plegar los resolvers en un único punto de auditoría a nivel de
  router; los handlers que escriben su propia fila más rica (hoy
  `viewAsHandler`) ponen `res.locals.auditHandled` tras un INSERT confirmado y
  `auditMutations` omite la fila del router (ver corrección de T4 y el
  seguimiento de la revisión nativa). Acciones de DGA y digest idénticas; se añadieron acciones para
  bitácora (`bitacora.ficha.patch`, `bitacora.contacto.*`, `bitacora.equipo.*`),
  reveals de PII, `auth.view_as` y `health_digest.prueba.send`; lo no mapeado
  cae en `v2.<método>.sin_mapear`. Efecto colateral aceptado: el
  `fetchBefore` de auditLog para targets conocidos (pozo_config, dga_informante)
  ahora corre antes de `protect`, igual que en v1. Test nuevo:
  `http/v2/__tests__/auditoria-escrituras.test.ts` (router real). Se corrigió el
  comentario de `actAsAudit.test.ts`. Commit: efdef21.
- Corrección de T4 (hallada en la revisión del padre): `POST /auth/view-as` exitoso
  dejaba 2 filas (`auth.view_as.issue` del handler + `auth.view_as` del router).
  RED: 1 test fallando (2 filas) -> GREEN. Mecanismo: el handler pone
  `res.locals.auditHandled = true` y `auditMutations` omite su fila en `finish`;
  los rechazos (403/422) siguen en la fila del router, una sola. Nombre
  `auth.view_as.issue` intacto. Tests: 2 casos nuevos en
  `auditoria-escrituras.test.ts`. `npm test` main-api: 85 archivos, 945 tests OK;
  typecheck OK.
- Commits: T1 7e8a776, T2 8778140, T3 3ddc030, T4 efdef21.
- Seguimiento (advertencias de la revisión nativa aprobada, linaje
  review-b0afbbf5a7e52de1): (1) `auditHandled` se marca solo si `record` confirma
  el INSERT (`record` ahora devuelve true/false; antes tragaba el error y no
  había forma de saberlo), así un INSERT fallido del handler deja la fila del
  router; (2) el resolver ignora la barra final y compara segmentos fijos sin
  distinguir mayúsculas (ni app.js ni el router v2 fijan `caseSensitive`/`strict`,
  así que se imita el default de Express), ids intactos; (3) este texto y el
  encabezado de `auditResolver.ts` corregidos. RED: 5 tests fallando (1 de INSERT
  fallido + 4 de barra/mayúsculas) -> GREEN. `npm test` main-api: 85 archivos,
  950 tests OK; typecheck OK.

## Siguiente paso

Revisar y fusionar los PRs 1, 2 y 3 en ese orden (decisión del usuario); tras
cada fusión, rebasar el siguiente sobre `main`.
