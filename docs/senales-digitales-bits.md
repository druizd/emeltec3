# Señales digitales — separar una palabra de bits

Cómo se configura y cómo funciona una variable que representa **una entrada
digital** (un bit de un registro donde cada bit es un contacto 0/1: marcha,
falla, límite de carrera). Vigente desde 2026-09-01.

Fuentes:

- `main-api/src/utils/mappingTransform.js` → `applyBitExtraction` (la matemática).
- `main-api/src/controllers/companyController.js` → validación y candado de `d1`.
- `main-api/src/services/siteTelemetryService.js` → `digitalMappings`, `serializeDigitalRow`.
- `frontend-angular/.../site-variable-settings-panel.ts` → configuración.
- `frontend-angular/.../site-digital-signals-timeline.ts` → visualización histórica.

---

## Problema

Un PLC con una tarjeta de entradas digitales no manda 16 registros: manda **uno
solo** donde cada bit es una entrada distinta. El registro llega como un entero
(`7`, `1024`, `34817`) que como magnitud no significa nada — solo tiene sentido
leído bit por bit.

Hasta ahora la plataforma solo sabía transformar un registro en **una** magnitud
analógica (factor/offset, IEEE754, uint32 de dos registros). No había forma de
decir "el bit 3 de este registro se llama Falla térmico".

---

## Decisión: una variable de `reg_map` por bit

Cada señal es una fila de `reg_map` con `transformacion = 'bit'`. Todas las
señales de una misma palabra **comparten `d1`** y se diferencian por
`parametros.bit`.

| alias          | d1      | transformacion | parametros                                    |
| -------------- | ------- | -------------- | --------------------------------------------- |
| Bomba activa   | `REG20` | `bit`          | `{bit: 0, palabra_bits: 16}`                  |
| Bomba 2 activa | `REG20` | `bit`          | `{bit: 1, palabra_bits: 16}`                  |
| Falla térmico  | `REG20` | `bit`          | `{bit: 2, palabra_bits: 16, invertido: true}` |

`parametros`:

| Llave          | Tipo    | Qué hace                                                    |
| -------------- | ------- | ----------------------------------------------------------- |
| `bit`          | entero  | Índice, **0 = menos significativo**. Obligatorio.           |
| `palabra_bits` | 16 / 32 | Ancho de la palabra. Default 16.                            |
| `invertido`    | bool    | Señal activa en 0 (contacto normalmente cerrado). Opcional. |
| `etiqueta_on`  | texto   | Presentación cuando vale 1. Opcional.                       |
| `etiqueta_off` | texto   | Presentación cuando vale 0. Opcional.                       |

### Por qué no se guardan 16 claves nuevas en la ingesta

`equipo.data` (JSONB) ya guarda el payload crudo, y las variables son **vistas
calculadas en lectura**. Definir los bits hoy alcanza hacia atrás hasta donde
llegue el registro, no cuesta storage y, si el técnico se equivoca de bit, lo
corrige y el histórico se corrige solo. Guardarlos en la ingesta sería lo
contrario: no retroactivo y con reproceso ante cada error de configuración.

### Por qué el valor es `1`/`0` numérico y no un booleano

Contadores, worker de alertas y export CSV hacen `Number()` sobre el valor. Un
booleano se cuela como `NaN` sin avisar. Las etiquetas ("Marcha"/"Detenido") son
presentación y viven en el frontend.

---

## La matemática

`applyBitExtraction(value, params)` en `main-api/src/utils/mappingTransform.js`:

1. Resuelve el ancho (`palabra_bits`, 16 o 32; cualquier otro valor cae a 16).
2. Valida que `bit` sea entero en `[0, ancho)`. Si no, **lanza**.
3. Valida que el crudo sea un entero sin signo que quepa en el ancho. Si no,
   **lanza**.
4. Devuelve `1` o `0`, invertido si corresponde.

Los dos `throw` son deliberados y siguen el mismo criterio que `applySignedWrap`:
un ancho mal elegido **no falla solo**. Los bits bajos seguirían dando 0/1
plausibles mientras los altos se pierden en silencio, y eso termina en un
histórico de señales inventado. Es preferible que el dashboard muestre el error.

Se usa división (`Math.floor(raw / 2 ** bit) % 2`) y no `>>>` para no depender de
la coerción a int32 de JavaScript con palabras de 32 bits.

---

## La palabra tiene que llegar en decimal

Los dos pipelines de ingesta convierten cada valor del CSV con
`strconv.ParseFloat` y guardan `map[string]float64`:

- `grpc-pipeline/csvprocessor/internal/parser/transformer.go:50`
- `ftp-pipeline/ftpprocessor/internal/parser/parser.go:133`

Es decir, `equipo.data` **siempre** trae números, nunca cadenas. Pero si el
equipo escribe la palabra en notación binaria en el CSV, el pipeline la
malinterpreta **al ingresar**:

```
CSV "0000000000001111"  →  ParseFloat  →  1111   (no 15)
```

A esa altura el daño ya está hecho y ninguna configuración de variable lo
arregla: hay que corregirlo en el export del PLC.

**Cómo detectarlo.** Con entradas reales la palabra toma valores arbitrarios
(`7`, `1024`, `34817`). Si el histórico crudo de ese registro solo muestra
números compuestos por ceros y unos (`1000`, `10101`, `111`), viene en binario.

El caso peligroso es el rango bajo, porque no salta ningún error:

```
crudo 7   → bits activos: [0, 1, 2]              ← correcto
crudo 111 → bits activos: [0, 1, 2, 3, 5, 6]     ← 111 = 0000000001101111
```

Los tres que se buscaban salen bien de casualidad y aparecen tres señales
activas que no existen. Con cualquier bit del byte alto encendido el valor pasa
de 65535 y ahí sí `applyBitExtraction` lanza.

---

## Reglas del backend

### El candado de `d1` se relajó, pero solo entre bits

`reg_map` no tiene UNIQUE sobre `(sitio_id, d1)`: el candado siempre vivió en
`companyController`. Antes rechazaba cualquier segundo mapeo sobre el mismo dato
original, lo que impedía crear el segundo bit.

Ahora (`findD1Conflict`):

| Situación                                        | Resultado                           |
| ------------------------------------------------ | ----------------------------------- |
| Dos bits distintos de la misma palabra           | ✅ conviven                         |
| Dos señales sobre el **mismo** bit               | ❌ 409, nombrando a la que lo ocupa |
| Un bit sobre un registro ya leído como analógico | ❌ 409                              |
| Una lectura analógica sobre una palabra con bits | ❌ 409                              |
| Dos variables analógicas sobre el mismo `d1`     | ❌ 409 (como siempre)               |

Mezclar un bit con una lectura analógica del mismo registro serían dos
interpretaciones incompatibles del mismo dato, y `getSiteVariables` indexa
`mappingsByKey` por `d1` — mostraría una de las dos al azar.

`PATCH` nunca revisó colisiones de `d1`. Ahora sí, pero **solo** cuando cambia el
dato original o cuando hay bits de por medio, para no romper sitios que ya
arrastran duplicados creados antes del candado.

### Una señal digital vive siempre en el rol `generico`

`bitRoleError` responde 400 si se intenta darle un rol de dashboard. Los roles
(caudal, nivel, totalizador, energía…) son magnitudes analógicas: un 0/1 metido
ahí entraría a contadores, al resumen y a DGA como si fuera una medición.

Ojo con esto: `inferVariableRoleFromValues` en el panel infiere el rol del alias,
así que "Nivel alto estanque" se iba derecho al slot `nivel`. El panel ahora
fuerza `generico` y oculta el selector.

---

## Histórico

Las señales digitales **no** pasan por el mecanismo de roles históricos
(`HISTORICAL_ROLES` + `findHistoricalVariable`), que asigna un mapping por rol con
búsqueda difusa de tokens: acá son N señales sin rol. Se resuelven por
transformación, que es exacta, y viajan en una clave aparte de cada fila:

```json
{
  "timestamp": "2026-01-01T03:01:00Z",
  "caudal": { "ok": true, "valor": 12.5, ... },
  "digitales": {
    "bomba_activa":  { "ok": true, "valor": 1, "alias": "Bomba activa",  "bit": 0, "error": null },
    "falla_termico": { "ok": true, "valor": 0, "alias": "Falla térmico", "bit": 2, "error": null }
  }
}
```

La clave de cada señal es la misma `responseKeyForMapping` que usa el dashboard
en vivo (slug del alias). `digitales` es `{}` en sitios sin señales — el shape de
la fila no depende de la configuración, así que el frontend puede hacer
`row.digitales[clave]` sin chequear.

`ok: false` (con `error`) es un instante en que el bit **no se pudo leer**. No es
lo mismo que un 0 y no debe dibujarse como apagado.

Las dos rutas que arman filas históricas producen lo mismo:

- `mapHistoricalDashboardRow` — de a una fila, la usa el export CSV.
- `createHistoricalRowMapper` — resuelve las señales una sola vez y por fila deja
  solo la aritmética del bit. La usa el endpoint `dashboard-history`.

Hay tests de paridad entre ambas en
`main-api/src/services/__tests__/siteTelemetryService.digitales.test.ts`; que
diverjan significaría que el CSV y el gráfico muestran cosas distintas del mismo
dato.

### Costo

Ninguno en SQL: la fila cruda ya se traía completa. Por fila se agregan N
llamadas a `applyBitExtraction` (aritmética pura). La resolución del catálogo de
señales ocurre una sola vez por request, igual que la de los roles.

---

## Export CSV

`digitales` es un **pseudo-campo** de `HISTORY_EXPORT_FIELDS`: no es una columna
sino una por señal del sitio, con el alias de cada una como encabezado. Por eso
el header y cada fila se arman con `flatMap` y no con `map`.

Va **al final** del listado por defecto a propósito: en un sitio con señales
digitales se agregan columnas después de las cuatro de siempre (Caudal, Nivel,
Totalizador, Nivel Freático), así que un consumidor que lee por posición las
cuatro primeras no se rompe. En un sitio sin señales no agrega ninguna.

Se puede pedir explícitamente con `?fields=digitales` o combinado
(`?fields=caudal,digitales`).

---

## Frontend

### Configuración

Panel de variables → transformación **"Señal digital (un bit de la palabra)"**.

- Cuadro de 8 columnas (un byte por fila, el más significativo arriba a la
  izquierda: se lee igual que el binario del manual) con el **estado en vivo** de
  cada bit. El técnico acciona la señal en terreno y ve qué celda cambia.
- Selector de ancho 16/32. Al angostar, un bit que ya no existe se recorta.
- Casilla "Señal activa en 0" y etiquetas ON/OFF.
- Lista de los bits ya configurados sobre ese dato, con editar y eliminar.
- Botón **"Cargar las 16 de una"**: una fila por bit con su estado en vivo,
  escribís el alias de las que uses y salen todas en un submit. Las que ya
  existen aparecen bloqueadas — el cargador solo crea, nunca pisa. Los POST van
  secuenciales (16 simultáneos competirían por el mismo candado de `d1`, y así
  cada fallo se atribuye a su bit). Ante un fallo parcial el cargador queda
  abierto, con las creadas bloqueadas y las que fallaron conservando su alias.

El popover "?" de Transformación tiene una sección "Señales digitales (bits)" con
la numeración de los bits, el formato decimal y el invertido, con ejemplos.

### Visualización

`app-site-digital-signals-timeline` (`site-digital-signals-timeline.ts`): una
banda por señal, verde donde el bit estuvo en 1, gris en 0 y **ámbar donde no
hubo lectura** — un hueco de transmisión no puede leerse como "la bomba estuvo
detenida". Ventanas de 6 h / 24 h / 7 días, y por señal el conteo de
activaciones (flancos de 0 a 1) de la ventana.

Es la vista que responde "¿a qué hora se disparó el térmico anoche?", que un
gráfico de líneas con 16 series superpuestas no responde.

Los tramos contiguos con el mismo estado se fusionan: un día a 1 minuto son un
puñado de `<span>` por señal y no 1440. El catálogo de señales sale de los
propios datos (cada fila trae alias y bit), recorriendo todos los puntos porque
una señal recién configurada puede faltar en los buckets más viejos.

Se monta en `company-site-coming-soon-detail` (la página de los sitios genéricos
y de proceso) y no renderiza nada si el sitio no tiene señales configuradas, así
que es seguro montarlo en cualquier página de detalle.

---

## Pendiente

**Alertas.** El worker lee el crudo del payload y se salta la transformación por
completo en la ruta general (`modules/alerts/worker.ts`, `data[alerta.variable_key]`
con `variable_key = d1`, comparado con `parseFloat`). Un bit no se puede expresar
con `mayor_que`. Haría falta una condición nueva sobre la palabra, o que la
alerta apunte a un `reg_map.id`. Además las alertas son por nivel con cooldown y
una señal digital quiere **flanco** ("pasó a 1"), no "está en 1 hace 3 horas".
