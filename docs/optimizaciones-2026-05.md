# Optimizaciones Operación Pozo — Mayo 2026

Sesión de performance + conexión de mocks restantes en la vista Operación de
pozos (`/companies/:siteId/water` → tabs Hoy, Histórico, Resumen por Período).

## Contexto del problema

- Primer paint del pozo: ~7s sobre Azure mobile.
- `operacion-bundle` cold: 4.4s.
- Tabs Resumen y Gráficos disparaban requests en el primer paint aunque
  el operador no estuviera mirando esas vistas.
- Material Symbols se bajaba como variable font completa (1.1 MB woff2).
- Cache HTTP de assets Angular no se respetaba: revalidación 304 por chunk.
- Mocks en Resumen por Período: turno breakdown, KPIs alertas/uptime, tabla
  diaria, chart sin tooltip.
- Caudal "en tiempo real" se contaminaba al navegar a días anteriores con
  las flechas.

## Resumen de wins

| Métrica | Antes | Después |
| --- | --- | --- |
| operacion-bundle cold | 4.4 s | 86 ms (51×) |
| dashboard-history (parent polling) | 3 s c/60 s | eliminado (lazy on modal open) |
| Primer paint Operación (mobile) | ~7 s | ~5 s |
| Material Symbols woff2 | 1.1 MB | 319 kB |
| Chunks JS revalidados por page load | 20 (~4 s RTT) | 0 (immutable cache) |
| Bundle JS realtime (water-detail-operacion) | incluía xlsx | xlsx en chunk lazy aparte |
| Requests cold path Operación tab Hoy | 6 | 2 (bundle + operacion-config) |

## Cambios backend (`main-api/src/...`)

### Endpoints nuevos

- **`GET /sites/:siteId/operacion-bundle?limit=N`**
  Empaqueta `dashboard + history` realtime + dedup pozo_config / reg_map.
  Cache en proceso (`operacionBundleInputsCache`, TTL 30 s) con inflight
  dedup. Invalidación hooked en `updateSite`, create/update/delete de
  variables. Server-Timing emite `db_site`, `db_inputs[_cached]`,
  `db_history`, `js_map`, `rows`, `total`.

- **`GET /sites/:siteId/period-aggregates?desde&hasta`**
  Max + promedio + count de caudal / nivel / nivel_freatico sobre el rango.
  Lee `equipo_5min` cagg, aplica mapper por fila.

- **`GET /sites/:siteId/period-aggregates-daily?desde&hasta`**
  Mismas métricas pero agrupadas por día Chile en SQL
  (`bucket AT TIME ZONE 'America/Santiago'::date`). Llena la tabla
  "Resumen diario" sin pedir el histórico crudo completo.

### SQL crítico

`bundle.history` original tenía un `UNION ALL` entre `equipo` raw y el cagg
con `COALESCE(lc.max_bucket + interval, now() - 2h)`. El planner de
TimescaleDB no sabía optimizar esa expresión → scan completo de chunks (4.3 s).
Reemplazado por query directa al cagg:

```sql
SELECT bucket AS time, received_at, id_serial, data, ...
FROM equipo_1min
WHERE id_serial = $1
  AND bucket >= now() - INTERVAL '48 hours'
ORDER BY bucket DESC
LIMIT $2
```

Trade-off documentado: pierde a lo más los 2 buckets más recientes que aún
no materializó el cagg (policy `end_offset=2 min`). Cubierto por
`dashboard.ultima_lectura` que sí lee raw equipo via
`loadLatestEquipoSample`. Para realtime tab que poll cada 60 s es
imperceptible.

### Per-row mapper optimizado

`siteTelemetryService.createHistoricalRowMapper({ site, mappings, pozoConfig,
sampleRawData })`:

- Pre-resuelve `role → mapping` UNA vez por request usando una fila de muestra
  como skeleton (necesario porque `buildDerivedNivelFreatico` filtra source
  por `Number.isFinite(Number(variable.valor))` — un skeleton con rawData
  vacío rompe la detección del nivel freático derivado).
- Cada fila ejecuta ≤4 `applyMappingTransform` (uno por rol) en lugar de
  iterar todos los mappings + búsqueda fuzzy de roles.
- Ahorro real: ~17k iteraciones + 17k token-matches eliminados para 2200
  rows × 8 mappings.

### Otros tweaks de cache

- `DASHBOARD_DATA_CACHE_TTL_MS`: 15 s → 30 s (frontend poll cada 60 s).
- `JORNADA_CACHE_TTL_S` (afecta jornadas + diarios): 300 s → 900 s.
- `parseLimit` en `dashboard-history`: max 500 → 3500 (para navegación por
  día que necesita ~2200 buckets cubriendo 2 días + cross-midnight).

### Server-Timing

`bundle` y `dashboard-history` emiten `Server-Timing` granular. `app.js` agrega
`exposedHeaders: ['Server-Timing']` para CORS cross-origin. El bundle
también escribe a stdout (`console.log`) para inspección directa via
`docker logs emeltec-api | grep operacion-bundle` cuando DevTools no es
opción.

## Cambios frontend (`frontend-angular/src/...`)

### nginx.conf

- `Cache-Control: public, max-age=31536000, immutable` para hashed assets
  (js, css, woff2, fonts, imágenes).
- `index.html` explicit `no-cache, no-store, must-revalidate` (siempre
  revalida para que nuevos deploys se vean).
- gzip on para JS/CSS/JSON (compresión ~47 % observada).
- Single `Cache-Control` header (sin `expires` directive para evitar
  duplicado que confunde a algunos browsers).

### index.html

Material Symbols pasó de:
```
?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap
```
a:
```
?family=Material+Symbols+Outlined:wght@400&display=swap
```
**Win: 1.1 MB → 319 kB**. Si se necesita FILL=1 o pesos distintos, agregar
valores discretos a la URL en lugar de rangos.

### water-detail-operacion (tab Hoy)

- **Lazy history polling**: removido del `ngOnInit` del padre
  (water-detail). Ahora arranca al `openHistoryView()` y se detiene al
  `closeHistoryView()`. Aplicado a water, vertiente y canal detail.

- **2 polling subs separadas**:
  - `pollingSub`: timer 60 s → bundle → llena `historyRows` (state) +
    `dashboardData`. Always realtime, drives sparkline + métricas top +
    "Caudal Actual" del banner.
  - `dayHistorySub`: subscribe a `selectedDayKey$`. Cuando el operador
    navega a un día distinto de hoy operativo → fetch range
    `(día-1, día+1)` → llena `dayHistoryRows` (local). Cuando vuelve a hoy
    → `dayHistoryRows.set([])`.
  - `effectiveDayRows` computed: `isToday ? historyRows : dayHistoryRows`.
    Usado por turno cards y total. **Garantía**: caudal/nivel/totalizador
    realtime NUNCA se contaminan con datos del día navegado.

- **Wall-clock tick + jornada-anchored day**:
  - `nowTick` signal refresh cada 60 s.
  - `currentJornadaDayKey` = `chileDayKey(nowTick - jornadaInicio horas)`.
    Si la jornada empieza a las 07:00 y son las 02:00 wall, el día operativo
    actual sigue siendo el calendario anterior.
  - `selectedDayKey = addDayKey(currentJornadaDayKey, diaOffset)`.

- **Total del Día = suma de turnos** (consistencia matemática). Antes
  `rowsForDay` filtraba por día calendario → no incluía la cola del
  Turno 3 que cruzaba medianoche → `sum(turnos) ≠ total`.

- **Formato horario turnos**: agrega sufijo "(día sig.)" cuando el turno
  cruza medianoche.

### water-operacion-state

- `OperacionPreset` ahora puede ser `null` cuando las fechas no matchean
  ningún preset canónico (7d/30d/90d ending hoy).
- `setPreset(p)`: setea preset + fechas.
- `onFechaChange`: re-detecta preset; si custom → null.
- `startCountersPolling`: ahora SOLO arranca config (turnos + jornada).
- **`ensureContadoresPolling`** (nuevo): arranca monthly/daily/jornada
  poll. Idempotente por siteId. **Lazy-triggered** por
  `operacion-resumen-periodo` y `operacion-graficos-historicos` en sus
  `ngOnInit` — solo se ejecuta cuando el operador entra a esas tabs.

### operacion-graficos-historicos

- **Lazy import xlsx**: `import * as XLSX from 'xlsx'` reemplazado por
  `import('xlsx')` dentro de cada handler de export. La library
  (~150 kB gzip) ya no infla el chunk del Operación tab.

### operacion-resumen-periodo (Resumen por Período)

Refactor grande para conectar mocks y mejorar UX:

#### Selector de período

- 2 sub-componentes con header propio ("Atajos" / "Rango personalizado")
  separados por un divisor vertical de 12 px en desktop.
- **Inputs locales** (`fechaDesdeInput`, `fechaHastaInput`) + botón
  **Aplicar**. Editar las fechas NO dispara fetches. Aplicar propaga al
  state global → todos los fetches dependientes re-disparan.
- Cuando se aplican fechas que no matchean un preset → preset queda en
  `null`, ningún botón resaltado, badge "Personalizado" aparece.
- Subtitle con rango activo formateado `DD/MM/YYYY → DD/MM/YYYY` siempre
  visible.

#### KPIs reales

Antes 4 de 6 reales (flujo total, caudal prom, nivel prom, días op) +
2 mock (alertas, uptime). Ahora **6 de 6 reales**:

- **Peak de caudal**: max global desde `period-aggregates`.
- **Nivel freático más alto**: idem.
- **Alertas en período**: `eventosReales.length` + breakdown críticas/adv.
- **Uptime comunicación**: `daysWithSamples / diasEsperados × 100 %`.
- `diasEsperados` ahora se calcula desde las fechas reales aplicadas
  (no del preset hardcoded) → soporta rangos custom.

#### Chart "Flujo diario en el período"

- `barData` mock reemplazado por `dailyInRange` real, ordenado
  cronológicamente.
- Step de labels adaptativo (~10 labels visibles independiente del rango).
- **Tooltip al hover**: hitbox transparente cubre todo el slot (no solo
  la barra delgada). Muestra `DD/MM/YYYY` + valor + unidad. Línea
  vertical de referencia. Soporta `touchstart` para mobile.
- Cuando una barra recibe hover, su opacity sube de 0.85 a 1.

#### Resumen operacional por turno (cards)

`mockTurnoFlujo` reemplazado por **3 calls paralelas** a
`getSiteJornadaCounters(siteId, { inicio, fin })` (una por turno). Trigger
en cambio de fechas, num turnos o config de turnos. Cache server-side
TTL 15 min absorbe rebotes. Suma deltas client-side filtrados al rango
aplicado. % distribución relativa al total visible.

#### Tabla "Resumen diario"

Reemplazado mock fijo de 7 días por **1 fila por día calendario en el
rango aplicado** (cap 60 filas). Cruza 3 fuentes:

| Columna | Fuente |
| --- | --- |
| Fecha | calendar generated `DD/MM/YYYY` |
| Flujo (m³) | `dailyCountersData[dia].delta` |
| Caudal peak | `dailyAggregates[dia].caudal.max` |
| Caudal prom. | `dailyAggregates[dia].caudal.avg` |
| Freático max | `dailyAggregates[dia].nivel_freatico.max` |
| Alertas | `eventosReales` bucketed por día Chile |

Días sin operación (flujo=0) renderizan con opacity 60. Celdas sin datos
muestran `—`. Alertas usan badge ambar.

### Componente service (`company.service.ts`)

Métodos nuevos:
- `getSiteOperacionBundle(siteId, limit)`
- `getSitePeriodAggregates(siteId, desde, hasta)`
- `getSitePeriodAggregatesDaily(siteId, desde, hasta)`

## Mocks restantes

- **Tabla de incidencias** (`mockIncidencias`): no hay endpoint backend.
  Default a `'30d'` para evitar crash con `preset === null`.

## Notas operacionales

### Sobre "30 / 90 días con operación"

Es dato real. `dailyCountersData.filter(p => p.delta > 0).length`.
Significa que solo 30 días del rango tuvieron incremento neto del
totalizador. Causas habituales: operación intermitente, mantenimiento,
sequía, pozo recién instalado.

### Sobre "Uptime 41 %"

`daysWithSamples / expectedDays × 100`. 41 % de 90 días = 37 días con
telemetría. El equipo no comunicó 53 de 90 días. Causas a investigar si
no se espera intermitencia: equipo recientemente instalado, caídas
modbus/GSM, worker dejó de procesar parte del histórico.

### Cache invalidation

`operacionBundleInputsCache` se invalida en:
- `updateSite`
- `createSiteVariableMap`
- `updateSiteVariableMap`
- `deleteSiteVariableMap`

TTL 30 s. Si admin edita via SQL directo o ruta no listada, cache puede
quedar stale hasta 30 s.

## Pendientes / siguiente capa de optimización

- **Materializar daily + jornada counters** (worker + tabla
  `site_contador_diario` / `_jornada`). Hoy cold path ~1 s; con
  materializar bajaría a ~30 ms.
- **Brotli** en nginx (10-15 % más de compresión que gzip).
- **Preload critical chunks** en index.html (`<link rel="modulepreload">`).
- **Tabla de incidencias real**: requiere endpoint backend
  `/sites/:id/incidencias?desde&hasta`.
- **Reducir cantidad de chunks JS** tuneando `angular.json` (vendor split,
  commonChunk strategy).
- **SSR + Transfer State** para primer paint instantáneo.

## Verificación post-deploy

1. Browser DevTools (cache enabled) → Network → 2do F5 → chunks deben
   aparecer como `(disk cache)` 0 ms.
2. `docker logs emeltec-api --tail=5 | grep operacion-bundle` → `total`
   bajo 100 ms warm, bajo 200 ms cold.
3. Operación tab Hoy → 2 requests en cold path (bundle + config), no
   contadores hasta entrar a Resumen/Históricos.
4. Click flecha izquierda en "Acumulado por turno" → dispara request
   `dashboard-history?from=X&to=Y` solo para días no-actuales.
5. Resumen por Período: click `7d` → fechas se setean a hoy-7→hoy, botón
   resaltado. Editar manualmente Desde → Aplicar → botón se desactiva,
   badge "Personalizado" aparece.
