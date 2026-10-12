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
  bitácora no la tienen. Verificado en producción el 2026-10-12: `PATCH
  /api/v2/sites/bitacora/equipos/EQ999999` con token "ver como" responde 403
  pero no deja fila en `audit_log`; la misma prueba en v1 (`PUT
  /api/alertas/999999999`) sí queda registrada con `impersonator_id`.
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
- [ ] T3 — Frontend: edición de turnos y jornada solo para SuperAdmin y Admin.
- [ ] T4 — Auditoría v2 antes de `protect`, sin filas duplicadas.

## Ruta por tarea

- T1–T4: delegada (writer único; toca 2 o más archivos no triviales por tarea).

## Entrega

- Pronóstico: unas 350–450 líneas de autoría (tests incluidos).
- Estrategia: `ask-on-risk`; si se superan unas 400 líneas se pregunta por la
  cadena antes del siguiente commit.

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
  fuera de alcance); el test lo cubre igual. Commit: se anota en el siguiente.

## Siguiente paso

T3.
