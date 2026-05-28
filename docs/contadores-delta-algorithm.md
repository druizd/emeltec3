# Algoritmo de cálculo de delta para contadores

Documento técnico del algoritmo que calcula el consumo (delta) mensual,
diario y por jornada de variables tipo contador/totalizador (rol_dashboard
∈ `totalizador`, `energia`, `volumen`). Vigente desde 2026-05-27.

Fuentes: `main-api/src/modules/contadores/service.ts` —

- `computeMonthDeltaForVariable` → delta mensual.
- `computeDailyDeltasForVariable` → delta diario.
- `computeJornadaDeltasForVariable` → delta por jornada (turno operativo).

Las tres funciones comparten el mismo pipeline de tres etapas.

---

## Problema

El totalizador físico es un contador monotónico ascendente (acumulador
total desde la instalación del medidor). Para mostrar consumo por periodo
necesitamos calcular `delta = valor_fin_periodo - valor_inicio_periodo`.

Complicaciones reales:

1. **Glitches de transmisión Modbus**: el sensor reporta `(0, 0)` cuando
   hay timeout o payload corrupto. Si se interpretara como lectura real,
   el algoritmo creería que el contador retrocedió y duplicaría el
   segmento al recalcular.
2. **Jitter del sensor**: lecturas con ruido en el último bit del float32.
3. **Reemplazo real del caudalímetro**: técnico cambia el medidor, el
   nuevo arranca en 0 y empieza a crecer. Hay que cerrar el segmento
   anterior y abrir uno nuevo desde 0 — sumar correctamente sin
   doble-conteo.
4. **Gaps al cambio de mes**: última lectura del mes N a las 23:48 y
   primera del mes N+1 a las 00:13. El consumo entre 23:48 y 00:00 se
   pierde si cada mes se calcula independiente.

---

## Pipeline (3 etapas)

### Etapa 1: `extractCounterSamples`

Recorre las filas del cagg `equipo_1min` (mensual) o `equipo_5min`
(jornada), aplica:

1. **`isZeroPayload(rawData, mapping)`** — descarta la fila si
   `data[mapping.d1] === 0` y (si `mapping.d2` está set) también
   `data[mapping.d2] === 0`. Firma típica de transmisión fallida.
2. **`applyMappingTransform`** — decodifica IEEE754 / lineal / uint32
   según `mapping.transformacion`. Si lanza o resulta NaN, descarta.

Output: array `CounterSample[] = { time, v }[]` con muestras válidas
ordenadas cronológicamente.

### Etapa 2: `filterTransientDips`

Aplica un lookahead de `RESET_CONFIRM_SAMPLES = 10` muestras para
distinguir glitch transitorio de reset real.

Para cada muestra `cur` con `cur.v < lastValid`:

- Mira las próximas `k - 1` muestras.
- **Si alguna `next.v >= lastValid`** → el contador se recuperó, el dip
  era glitch puntual. Descarta `cur`.
- **Si alguna `next.v < lastLow`** (no monotónica desde el dip) → patrón
  caótico de glitch múltiple. Descarta `cur`.
- **Si las `k - 1` siguientes son monotónicas y todas < lastValid** →
  reset real confirmado. `cur` pasa a la etapa 3 (donde el algoritmo de
  segmentos la procesará como reset).

`initialLastValid` (opcional) permite sembrar el filtro con el valor
final del periodo anterior — ver Etapa 3 (continuidad cross-month).

### Etapa 3: Algoritmo de segmentos

Procesa la lista limpia de muestras. Estado:

- `valorInicio` — primera muestra del periodo.
- `valorFin` — última muestra procesada.
- `segmentBase` — valor en que arrancó el segmento actual.
- `prev` — última muestra procesada.
- `suma` — acumulador de deltas cerrados.

Para cada muestra:

- Si es la primera, set `valorInicio`, `segmentBase`.
- Si `v < prev` (reset confirmado por filtro) → cierra segmento:
  `suma += prev - segmentBase`, `segmentBase = v`, `resets++`.
- `prev = v`, `valorFin = v`.

Al terminar el periodo:

- Cierra el último segmento: `suma += valorFin - segmentBase`.
- `delta = max(0, suma)` (negativos imposibles tras filtro).

---

## Continuidad cross-month (solo mensual)

Antes de procesar el mes, query auxiliar:

```sql
SELECT data FROM equipo_1min
WHERE id_serial = $1
  AND bucket >= (start - INTERVAL '7 days')
  AND bucket < start
ORDER BY bucket DESC LIMIT 1
```

Si encuentra una fila válida (no zero-payload, transformación OK,
seed > 0), siembra `prev = segmentBase = seed_value`. Este seed también
se pasa como `initialLastValid` al filtro de la Etapa 2.

Efecto: el delta del mes N incluye el consumo ocurrido entre la última
lectura del mes N-1 y la primera del mes N. La columna `valor_inicio` se
mantiene con la primera lectura DEL mes (semántica de transparencia).

Ventana de 7 días: si el sensor estuvo offline más tiempo, no se siembra
(evita enlazar tras paradas largas o reemplazos).

---

## Detección de reset real

Caso de uso: técnico reemplaza el caudalímetro de S042 a las 10:34.

Sample timeline (cada 1 min):

```
10:33  v = 540,500   ← normal
10:34  v = 0         ← post-reemplazo, sensor nuevo arranca de 0
10:35  v = 3
10:36  v = 7
10:37  v = 12
...
10:43  v = 35
10:44  v = 41
```

Filtro Etapa 2 en sample 10:34:

- `lastValid = 540,500`, `cur.v = 0` → 0 < 540500, entra al lookahead.
- Inspecciona samples 10:35..10:43 (9 más, total k=10).
- Todas < 540500 (siguen siendo 3, 7, 12, ...).
- Todas monotónicamente crecientes desde 0.
- `confirmed = 10 >= k` → **reset confirmado**, pasa sample 10:34.

Etapa 3 procesa sample 10:34:

- `prev = 540,500` (último valor pre-reset), `v = 0`.
- `v < prev` → reset → `suma += 540,500 - segmentBase`.
- `segmentBase = 0`, `prev = 0`, `resets++`.

Samples 10:35..10:44 procesan normalmente, creciendo desde 0. Al final
del mes, `suma` incluye consumo pre-reset + post-reset sin doble-conteo.

Latencia: 10 minutos entre el reset físico y la confirmación. Las primeras
10 muestras post-reset no se contabilizan hasta confirmar. En la práctica
irrelevante (el reset es un evento de instalación, no algo continuo).

---

## Tuning

Constantes en `service.ts`:

- `RESET_CONFIRM_SAMPLES = 10`: minutos de confirmación para reset real.
  Subir si hay sensores con dropouts intermitentes que duran 5-9 minutos
  (raro). Bajar si quieres detectar resets más rápido (cuidado: falsos
  positivos suben).

- Seed window cross-month: hardcodeado a `INTERVAL '7 days'` en la query.
  Subir si los sitios pueden estar offline más de una semana en
  transición de mes y aún así quieres link. Bajar para más conservador.

Si un sitio tiene perfil distinto (ej. agua con consumo eventual donde
0 m³ por minuto es normal, vs riles que siempre fluye), por ahora todos
comparten constante. Si hace falta diferenciar por `rol` o `sitio_id`,
añadir parámetros al mapping.

---

## Operación

### Backfill inicial al desplegar

Tras aplicar `2026-05-15-site-contador-mensual.sql` y compilar la imagen
con el algoritmo nuevo:

```bash
# 1. Asegurar que los caggs equipo_1min/5min están materializados
docker exec emeltec-db psql -U postgres -d telemetry_platform \
  -c "CALL refresh_continuous_aggregate('equipo_1min', NULL, now() - INTERVAL '2 minutes');"
docker exec emeltec-db psql -U postgres -d telemetry_platform \
  -c "CALL refresh_continuous_aggregate('equipo_5min', NULL, now() - INTERVAL '10 minutes');"

# 2. Backfill de todos los sitios, 36 meses (tomará ~10-15 min)
docker exec emeltec-api node /app/scripts/backfill-contadores-mensuales.js --meses=36

# 3. Verificar (un sitio cualquiera)
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
SELECT mes, valor_inicio, valor_fin, delta, resets_detectados
FROM site_contador_mensual
WHERE sitio_id='S100' AND muestras > 0
ORDER BY mes ASC;"
```

### Recompute puntual

Para un sitio (ej. tras corregir un mapping):

```bash
docker exec emeltec-api node /app/scripts/backfill-contadores-mensuales.js \
  --sitio=S042 --meses=12
```

Idempotente: hace UPSERT con PK `(sitio_id, variable_id, mes)`.

### Refresh automático

El worker (`modules/contadores/worker.ts`) corre cada hora y recomputa
el mes actual + mes anterior. Los meses históricos solo se tocan con
backfill manual.

---

## Verificación de calidad

Query rápido para detectar sitios con `delta` desviado de `crecimiento_simple`:

```sql
SELECT
  sitio_id,
  mes,
  valor_inicio,
  valor_fin,
  (valor_fin - valor_inicio) AS crecimiento_simple,
  delta,
  delta - (valor_fin - valor_inicio) AS diff,
  resets_detectados
FROM site_contador_mensual
WHERE muestras > 0
  AND ABS(delta - (valor_fin - valor_inicio)) > 100
ORDER BY ABS(delta - (valor_fin - valor_inicio)) DESC
LIMIT 50;
```

Resultados esperables:

- `diff` cerca de 0 con `resets_detectados = 0` → sano.
- `diff` ≈ 1-10 m³ con `resets = 0` → recuperación cross-month legítima.
- `diff` grande con `resets > 0` → revisar si el reset es real o si el
  sensor tuvo glitches no capturados por `isZeroPayload`. Inspeccionar
  con:

```sql
SELECT bucket, data
FROM equipo_1min
WHERE id_serial = (SELECT id_serial FROM sitio WHERE id='S042')
  AND bucket >= '2026-04-01' AND bucket < '2026-05-01'
ORDER BY bucket;
```

---

## Historia

- **2026-05-15** Tabla `site_contador_mensual` + worker hourly.
- **2026-05-22** Caggs `equipo_1min/5min/hourly/daily` con `last(data)`.
- **2026-05-27** Algoritmo refactorizado a 3-etapas:
  - `isZeroPayload` filter (descarta glitches Modbus puntuales).
  - `filterTransientDips` lookahead (distingue glitch parcial de reset
    real).
  - Continuidad cross-month (recupera consumo en gaps de borde de mes).
