# "Ver como" con permisos reales del servidor

## Objetivo

Que la opción "ver como" (ícono de ojo del SuperAdmin) muestre lo que el rol
elegido realmente obtiene del servidor, y no solo un filtro del navegador.

## Problema

- `frontend-angular` guarda el rol simulado en `sessionStorage`
  (`view_as_role`) y filtra en el navegador; las llamadas a la API siguen
  saliendo con el token de SuperAdmin.
- El backend no tiene contraparte (sin `view_as`, `impersonat` ni `act_as`).
- Ya figura como hallazgo EMT-L05 en
  `docs/security-audit/INFORME-AUDITORIA-SEGURIDAD-2026-06.md` (líneas 218 y 401).
- El selector muestra "Cliente → Sitio", pero la regla de negocio (confirmada
  el 12-10-2026) es que Cliente ve toda su división (sub_empresa), incluidos
  riles, energía y demás módulos. El backend ya lo implementa así
  (`main-api/src/shared/permissions.ts`).

## Alcance autorizado

- Endpoint que emite un token "ver como" solo para SuperAdmin.
- Token de 30 minutos con rol y alcance elegidos (`tipo`, `empresa_id`,
  `sub_empresa_id`), `act_as: true` y `real_sub` (id del SuperAdmin).
- Modo **solo lectura**: el backend rechaza cualquier método distinto de
  GET/HEAD/OPTIONS cuando el token es "ver como".
- Auditoría: el registro identifica al SuperAdmin que suplanta.
- Frontend: al activar "ver como" pide el token y lo usa en las llamadas; al
  salir lo descarta. Etiqueta "Sitio" → "División".
- Tests de autorización.

Fuera de alcance (otro PR): tokens de propósito aceptados por `protect`,
sesiones de 12 h del login v2, falta de control de rol en `PUT operacion-config`.

## Criterios de aceptación

- Solo un SuperAdmin real obtiene un token "ver como"; cualquier otro rol o un
  token "ver como" recibe 403.
- Con el token "ver como", las lecturas devuelven exactamente lo que el rol y
  alcance elegidos obtendrían (mismos filtros del servidor).
- Con el token "ver como", toda escritura responde 403 sin efectos.
- El token vence a los 30 minutos y no puede pedir otro token "ver como".
- `audit_log` registra al SuperAdmin real en las acciones hechas con el token.
- Salir de "ver como" restaura el token propio sin recargar sesión.

## Modo TDD

No configurado en el proyecto (sin `strict_tdd` ni equivalente). Se ejecutan
los checks funcionales: `main-api` → `npm test` (vitest), `auth-api` →
`npm test` (node --test), `frontend-angular` → build y `npm test` si aplica.

## Tareas

- [x] T1 — Backend: emisión del token "ver como" + reconocimiento en `protect`
  - bloqueo de escrituras + auditoría del suplantador + tests.
- [x] T2 — Frontend: pedir/usar/descartar el token "ver como", corregir la
      etiqueta "Sitio" → "División".
- [x] T3 — Corrección: auditoría registra al suplantador en escrituras bloqueadas
      (hallazgo de verificación independiente).

## Ruta por tarea

- T1: delegada (writer único; toca 2+ archivos no triviales). Hecha.
- T2: delegada (writer único; toca 2+ archivos no triviales).
- T3: delegada (writer único; corrección acotada).

## Progreso y evidencia

- Rama `feat/ver-como-servidor` desde `origin/main` (4bf435f), en worktree
  `../emeltec3-view-as`.
- T1 hecha. Commit: `feat(main-api): emitir token "ver como" de solo lectura para SuperAdmin`.
  - Endpoint `POST /api/v2/auth/view-as` (nginx `/api/` → main-api; `/api/auth/`
    iría a auth-api, por eso no se usó). Body `{ role, empresa_id, sub_empresa_id }`;
    responde `{ ok, data: { token, expires_in: 1800, expires_at, view_as } }`.
  - `protect` v2 y legacy: token `act_as` solo GET/HEAD/OPTIONS (403 si no),
    revocación contra `real_sub`, `req.actAs`. Lógica común en `services/actAs.js`.
  - Token lleva `id: "view-as"` (no el del SuperAdmin) para no heredar
    `usuario_sitio`/alertas propias; Vendedor ve solo maletas piloto.
  - Sin `require2fa`: el token no escribe y el SuperAdmin ya lee todo.
  - Auditoría: migración `016_audit_impersonator.js` (`audit_log.impersonator_id`,
    nullable) + registro `auth.view_as.issue` al emitir.
  - Verificación: `cd main-api && npm test` → 81 archivos, 918 tests OK;
    `npm run typecheck` → sin errores; prettier OK en lo tocado.
- T2 hecha (frontend-angular).
  - `AuthService.setViewAsContext` hace `POST /api/v2/auth/view-as` con el token real
    (`USE_REAL_TOKEN` en `HttpContext`); guarda el token en `sessionStorage`
    (`view_as_token`) junto al contexto; `jwt_token` nunca se toca. Errores: toast con
    el mensaje del servidor.
  - Interceptor: usa el token "ver como" si existe, salvo llamadas `USE_REAL_TOKEN`
    (emitir, árbol completo del selector). 401 con token "ver como" → `endViewAsExpired()`
    (toast "La vista 'ver como' expiró", vuelve al rol real, sin logout). 403 en no-GET →
    toast con el mensaje de solo lectura. Un 403 por permisos del rol no termina la vista.
  - Vencimiento: timer a `exp` del token; al recargar se descarta si venció o falta el
    token; con "ver como" restaurado no se llama `/api/users/me`.
  - Selector: Cliente ahora elige empresa + división (sin sitio); etiqueta "División";
    Vendedor solo empresa. El árbol del selector usa `fetchPreviewTree()` (token real)
    porque bajo "ver como" `/companies/tree` viene acotado. Filtro cliente de Cliente
    = por división (como el servidor).
  - Verificación: `cd frontend-angular && npx ng build` → OK (solo warnings previos de
    budget/hammerjs); `npm test` → 16 archivos, 272 tests OK; eslint y prettier OK en
    lo tocado.
- T3 hecha. Defecto: ambos `protect` devolvían el 403 de solo lectura antes de poner
  `req.user`/`req.actAs`, así que `auditMutations` (montado antes del router) registraba
  el intento con actor e `impersonator_id` nulos. Ahora ambos depositan la identidad antes
  de rechazar (misma respuesta). Test nuevo `actAsAudit.test.ts` (Express real + legacy y
  v2 + audit con DB espiada; también token vencido y HS512 → 401). Test de actAs.test.ts
  que armaba `req` a mano ahora usa lo que `protect` deja realmente.
  - RED (código sin corregir): 2 fallos, `actor_id` null en legacy y v2.
  - GREEN: `npm test` → 82 archivos, 926 tests OK; `npm run typecheck` sin errores;
    prettier y eslint OK en lo tocado.

## Siguiente paso

Revisión final de la rama y PR (decisión del usuario).
