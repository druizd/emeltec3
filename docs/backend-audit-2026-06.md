# Backend Audit — Junio 2026

Auditoría técnica del backend `main-api`. Objetivo: diagnosticar caída de
rendimiento y enumerar puntos de mejora de calidad. Ordenado de más urgente a
menos urgente.

---

## ALTA PRIORIDAD — Impactan cada request en producción

---

### 1. Legacy `metricsService.js` activo en el hot path de telemetría

**Archivo:** `src/services/metricsService.js:16` · `src/controllers/dataController.js:140`

**Qué hace:** Cada request a `GET /api/data/*` llama tres funciones en secuencia:
- `trackRequest(...)` → 1 UPSERT a `api_metrics`
- `registerVariableMetrics(...)` → N UPSERTs secuenciales (uno por variable)
- `getRequestMetrics(...)` → 1 SELECT de vuelta

Resultado: **3 o más round-trips a la base de datos por cada request de telemetría**, en el hot path.

**Por qué pasa:** El módulo `modules/metrics/buffer.ts` + `flusher.ts` fue construido para reemplazar esto (batch en memoria, flush cada 5 s), pero nunca se conectó a los endpoints v1. El código viejo quedó activo en paralelo.

**Cómo se soluciona:**
1. En `dataController.js`, reemplazar las llamadas a `metricsService` por `trackEndpoint()` y `trackVariable()` del buffer.
2. Remover las llamadas a `getRequestMetrics()` del request path (las métricas se leen aparte, no en cada request).
3. Verificar que `startMetricsFlusher()` está siendo llamado en `app.js`.

**Impacto esperado:** Elimina 3+ DB writes por request de datos. En clientes con polling cada 30 s con múltiples seriales, esto puede reducir la carga de BD hasta un 60–70% en esas tablas.

---

### 2. N+1 en el ciclo del worker de alertas

**Archivos:** `src/services/alertaService.js:177` · `src/modules/alerts/worker.ts:536`

**Qué hace:** `runCycle()` carga todas las alertas activas y llama `evaluarAlerta()` por cada una. Dentro, se ejecutan dos queries por alerta:
1. Cooldown: `SELECT FROM alertas_eventos WHERE alerta_id = $1 ...`
2. Telemetría: `SELECT data FROM equipo WHERE id_serial = $1 ORDER BY time DESC LIMIT 1`

Para N alertas activas: **1 + 2N queries por ciclo de 60 segundos** usando el mismo pool.

**Por qué pasa:** El evaluador fue diseñado para ser simple y operar por alerta individual. Nunca se refactorizó para trabajar en batch.

**Cómo se soluciona:**
1. Antes de iterar alertas, prefetch telemetría en una sola query:
   ```sql
   SELECT DISTINCT ON (id_serial) id_serial, data, time
   FROM equipo WHERE id_serial = ANY($1::text[])
   ORDER BY id_serial, time DESC
   ```
2. Cooldowns en una sola query:
   ```sql
   SELECT alerta_id, MAX(triggered_at) AS last_triggered
   FROM alertas_eventos WHERE alerta_id = ANY($1::int[])
   GROUP BY alerta_id
   ```
3. La iteración de alertas opera sobre los mapas en memoria, sin más queries.

**Impacto esperado:** Con 100 alertas activas: de 201 queries/ciclo a 3 queries/ciclo.

---

### 3. Resultado sin límite en `queryDatoDgaBySite`

**Archivo:** `src/modules/dga/repo.ts:948`

**Qué hace:** La query `WHERE site_id = $1 AND ts >= $2 AND ts < $3 ORDER BY ts ASC` no tiene `LIMIT`. Un rango de 6 años para un pozo con slots horarios devuelve ~52,000 filas en una sola respuesta. Esas filas luego se serializan a JSON y se cachean en Redis como un blob único de varios MB.

**Por qué pasa:** La función fue escrita sin cap de filas. El controller no valida el ancho del rango de fechas.

**Cómo se soluciona:**
1. Agregar cap en la repo: `LIMIT 10000` (o parámetro configurable).
2. En el controller/service, validar que `hasta - desde` no exceda 365 días.
3. Devolver `{ rows, truncated: boolean, total_returned }` para que el frontend pueda mostrar un aviso.

**Impacto esperado:** Elimina spikes de memoria en requests con rangos amplios. Reduce el tamaño de entradas en Redis cache.

---

### 4. N+1 en `getEmpresas` — sub-company query por empresa

**Archivo:** `src/controllers/userController.js:58`

**Qué hace:**
```js
const data = await Promise.all(
  empresaRows.map(async (emp) => {
    const { rows: subs } = await db.query(
      'SELECT id, nombre FROM sub_empresa WHERE empresa_id = $1', [emp.id]
    );
    return { ...emp, sub_empresas: subs };
  })
);
```
Para un SuperAdmin con 50 empresas, esto dispara 51 queries.

**Por qué pasa:** Se usa `Promise.all` para paralelizar, pero sigue siendo N queries en lugar de 1.

**Cómo se soluciona:**
```js
const ids = empresaRows.map(e => e.id);
const { rows: allSubs } = await db.query(
  'SELECT empresa_id, id, nombre FROM sub_empresa WHERE empresa_id = ANY($1::text[]) ORDER BY nombre',
  [ids]
);
const subsByEmpresa = allSubs.reduce((map, s) => {
  (map[s.empresa_id] ??= []).push(s);
  return map;
}, {});
const data = empresaRows.map(e => ({ ...e, sub_empresas: subsByEmpresa[e.id] ?? [] }));
```

**Impacto esperado:** De 51 queries a 2 queries para `GET /api/users`. Con > 50 empresas la diferencia es significativa.

---

## MEDIA PRIORIDAD — No afectan cada request pero sí la estabilidad

---

### 5. `cacheWarmer` puede matar el proceso con `unhandledRejection`

**Archivo:** `src/modules/sites/cacheWarmer.ts:47`

**Qué hace:**
```ts
void warmAll();
setInterval(() => void warmAll(), INTERVAL_MS);
```
`warmAll()` no tiene try/catch en el nivel superior. Si `getActiveSiteSerials()` falla (BD no disponible al arrancar), el Promise rechaza, `void` lo descarta, y Node.js emite `unhandledRejection`. En Node ≥ 15 eso termina el proceso.

**Por qué pasa:** Los demás workers tienen `try/catch` global en `runCycle()`. El cache warmer se escribió sin ese patrón.

**Cómo se soluciona:**
```ts
async function warmAll(): Promise<void> {
  try {
    // ... código existente
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'cacheWarmer: error en ciclo');
  }
}
```

---

### 6. `cacheWarmer` — `setInterval` sin handle (no se puede detener)

**Archivo:** `src/modules/sites/cacheWarmer.ts:49`

**Qué hace:** El handle del `setInterval` no se guarda. No existe `stopCacheWarmerWorker()`. Durante el shutdown (SIGTERM), el warmer sigue disparando queries a la BD mientras el pool se está cerrando.

**Cómo se soluciona:**
```ts
let handle: NodeJS.Timeout | null = null;

export function startCacheWarmerWorker(): void {
  if (handle) return;
  handle = setInterval(() => void warmAll(), INTERVAL_MS);
  handle.unref?.();
}

export function stopCacheWarmerWorker(): void {
  if (handle) { clearInterval(handle); handle = null; }
}
```

---

### 7. Errores de email silenciados — `notificado = TRUE` aunque no llegó nada

**Archivos:** `src/services/alertaService.js:169` · `src/modules/alerts/worker.ts:198`

**Qué hace:**
```js
for (const u of usuarios) {
  await sendAlertEmail(...).catch(() => {});  // error descartado
}
// después: UPDATE alertas SET notificado = TRUE
```
Si el email provider está caído, todos los envíos fallan en silencio, pero `notificado` queda en `TRUE`. La alerta nunca llega.

**Cómo se soluciona:**
1. Cambiar `.catch(() => {})` por `.catch((err) => logger.error(...))`.
2. Marcar `notificado = TRUE` solo si **al menos un** envío fue exitoso.
3. Opcionalmente: loguear cuáles usuarios fueron notificados y cuáles fallaron.

---

### 8. `listarAlertas` sin paginación

**Archivo:** `src/controllers/alertaController.js:134`

**Qué hace:** `GET /api/alertas` devuelve todos los registros sin `LIMIT`. El endpoint hermano `listarEventos` sí pagina; este no.

**Cómo se soluciona:** Agregar `LIMIT $n OFFSET $m` y parámetros `page`/`limit` en el query string, con un default de `limit=100`.

---

### 9. `getAllUsers` sin paginación

**Archivo:** `src/controllers/userController.js:74`

**Qué hace:** `GET /api/users` devuelve todos los usuarios sin `LIMIT`. Con la refactorización del N+1 de sub-empresas (Issue 4), este endpoint queda más eficiente, pero el payload sigue siendo ilimitado.

**Cómo se soluciona:** Igual que Issue 8 — `LIMIT`/`OFFSET` con `page`/`limit`.

---

### 10. Redis cache sin límite de tamaño — DGA dato

**Archivo:** `src/modules/dga/service.ts:233`

**Qué hace:**
```ts
await cache.set(cacheKey, JSON.stringify(rows), 300);
```
No hay cap en el tamaño de lo que se cachea. Resuelto en parte con el Issue 3 (limitar filas), pero sin un cap explícito de bytes sigue siendo posible cachear blobs grandes.

**Cómo se soluciona:** Agregar validación antes de cachear:
```ts
const serialized = JSON.stringify(rows);
if (serialized.length < 1_000_000) {  // no cachear si supera 1 MB
  await cache.set(cacheKey, serialized, 300);
}
```

---

### 11. `generateSequentialId` — condición de carrera en IDs

**Archivo:** `src/controllers/companyController.js:379`

**Qué hace:** Lee todos los IDs con `LIKE 'E%'`, calcula el máximo en JS, retorna `max + 1`. Dos requests simultáneos pueden calcular el mismo ID y uno de los dos recibirá un error de constraint violada.

**Por qué pasa:** Patrón read-compute-write sin lock. El error se maneja (devuelve 409), pero genera ruido y una mala UX.

**Cómo se soluciona:** Usar una secuencia Postgres por tipo:
```sql
CREATE SEQUENCE IF NOT EXISTS empresa_seq START 100;
-- En el INSERT: 'E' || nextval('empresa_seq')
```
O: agregar `SELECT ... FOR UPDATE` al SELECT para que el lock sea explícito.

---

### 12. `auditLogController` — JOIN de 5 tablas innecesario en count

**Archivo:** `src/controllers/auditLogController.js:96`

**Qué hace:** El `COUNT(*)` para paginación incluye LEFT JOINs a `alertas`, `alertas_eventos`, `incidencias`, `documentos` — incluso cuando no se filtra por `sitio_id`.

**Cómo se soluciona:** Condicionar los JOINs:
```js
const joinClause = sitioId ? `LEFT JOIN alertas ... LEFT JOIN incidencias ...` : '';
```
O: usar un `SELECT COUNT(*) FROM audit_log WHERE ...` simple sin JOINs cuando el filtro es solo por fechas/usuario.

---

## BAJA PRIORIDAD — Técnicamente correctos, se pueden mejorar

---

### 13. `fs.readFileSync` en module load en `emailService.js`

**Archivo:** `src/services/emailService.js:27`

**Qué hace:** 3 `readFileSync` al cargar el módulo. Bloquea el event loop durante el boot si el filesystem es lento.

**Cómo se soluciona:** Usar `fs.readFile` async con una promesa, resuelta antes del primer envío de email. Impacto real: mínimo en filesystem local, pero es un bad pattern.

---

### 14. `LIKE 'E%'` en PK de texto bajo collation UTF-8

**Archivo:** `src/controllers/companyController.js:383`

**Qué hace:** Query para generar el próximo ID secuencial. Bajo collation `en_US.UTF-8` de Postgres, `LIKE 'E%'` en un text PK no puede usar un B-tree index convencional y hace seq-scan.

**Cómo se soluciona:** Crear un índice con collation explícita:
```sql
CREATE INDEX ON empresa (id COLLATE "C");
```
O resolver con la secuencia Postgres del Issue 11 (que elimina esta query por completo).

---

### 15. SHA-256 síncrono en `auditLog.js` por cada mutación

**Archivo:** `src/services/auditLog.js:23`

**Qué hace:** `crypto.createHash('sha256').update(JSON.stringify(payload))` en el handler de `res.on('finish')`. Para payloads grandes bloquea el event loop ~1 ms después de enviar la respuesta.

**Cómo se soluciona:** Si el payload supera 64 KB, usar `crypto.subtle.digest()` (async WebCrypto API disponible en Node ≥ 19) o simplemente omitir el hash para payloads que excedan ese tamaño.

---

## Resumen ejecutivo

| # | Archivo | Problema | Prioridad |
|---|---------|----------|-----------|
| 1 | `services/metricsService.js` + `controllers/dataController.js` | Legacy metrics: 3+ DB hits por request | **ALTA** |
| 2 | `services/alertaService.js` + `modules/alerts/worker.ts` | N+1: 2N queries por ciclo de alertas | **ALTA** |
| 3 | `modules/dga/repo.ts:948` | Resultado sin LIMIT — spike de memoria y Redis | **ALTA** |
| 4 | `controllers/userController.js:58` | N+1: sub-company query por empresa | **ALTA** |
| 5 | `modules/sites/cacheWarmer.ts:47` | unhandledRejection puede matar el proceso | **MEDIA** |
| 6 | `modules/sites/cacheWarmer.ts:49` | setInterval sin handle — no se detiene en shutdown | **MEDIA** |
| 7 | `services/alertaService.js:169` | Errores de email silenciados, notificado=TRUE falso | **MEDIA** |
| 8 | `controllers/alertaController.js:134` | listarAlertas sin paginación | **MEDIA** |
| 9 | `controllers/userController.js:74` | getAllUsers sin paginación | **MEDIA** |
| 10 | `modules/dga/service.ts:233` | Redis cache sin cap de tamaño | **MEDIA** |
| 11 | `controllers/companyController.js:379` | Race condition en generación de IDs | **MEDIA** |
| 12 | `controllers/auditLogController.js:96` | JOIN innecesario en COUNT de paginación | **MEDIA** |
| 13 | `services/emailService.js:27` | readFileSync en module load | **BAJA** |
| 14 | `controllers/companyController.js:383` | LIKE en PK texto sin índice C collation | **BAJA** |
| 15 | `services/auditLog.js:23` | SHA-256 síncrono post-response | **BAJA** |

**Issues 1–4 resueltos en conjunto pueden reducir la carga sobre la base de datos en un 50–70% en el hot path de telemetría y en el ciclo de alertas.**
