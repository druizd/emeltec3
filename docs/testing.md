# Testing — Emeltec Cloud

Cada paquete del monorepo usa su propio runner. Para no tener que recordar el
comando de cada uno, `scripts/run-all-tests.js` ejecuta todas las suites y
entrega un resumen consolidado.

## Correr todo

```bash
node scripts/run-all-tests.js
```

Salida (ejemplo):

```text
════════════════════════════════════════════════════════════════
  Suite de tests — Emeltec Cloud
════════════════════════════════════════════════════════════════

▸ main-api  (vitest)
    • src/services/__tests__/dataAccess.test.ts
    • src/modules/dga/__tests__/...
    → 91 pasados, 0 fallidos

▸ auth-api  (node:test)
    • src/services/__tests__/securityPolicy.test.js
    → 8 pasados, 0 fallidos

────────────────────────────────────────────────────────────────
  TOTAL: 99 pasados · 0 fallidos
────────────────────────────────────────────────────────────────
```

El proceso termina con código de salida `1` si alguna suite falla, por lo que
sirve en CI o en un hook de pre-push.

## Qué runner usa cada paquete

| Paquete    | Runner      | Patrón de tests              | Comando individual |
| ---------- | ----------- | ---------------------------- | ------------------ |
| `main-api` | Vitest      | `src/**/__tests__/*.test.ts` | `npx vitest run`   |
| `auth-api` | `node:test` | `src/**/__tests__/*.test.js` | `node --test`      |

El agregador detecta automáticamente el total de cada uno: Vitest reporta el
número **antes** de `passed` (`Tests 91 passed`) y `node:test` lo reporta
**después** de `pass` (`# pass 8`). El script normaliza ambos formatos y limpia
los códigos de color ANSI.

## Cobertura actual (honesta)

Los tests existentes cubren **lógica**, no integración end-to-end:

- **Control de acceso multi-tenant** — `main-api/src/services/dataAccess.js`
  (`canAccessSite`, `resolveAccessibleSerial`, `findUnauthorizedSites`, etc.).
- **Política de autenticación** — `auth-api/src/services/securityPolicy.js`
  (backoff de lockout exponencial, TTL/uso único de OTP).
- **Módulos DGA** — suites preexistentes en `main-api`.

**No** cubren rutas ni controladores extremo a extremo (eso requeriría tests de
integración con base de datos). El resumen del script lo deja explícito para no
dar una falsa sensación de cobertura total.

> Relacionado: `pnpm test` corre los tests vía los scripts de cada workspace;
> `run-all-tests.js` es el atajo de un solo comando con resumen unificado.
