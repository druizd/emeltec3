# Brief — Conversión de histórico de telemetría cruda al formato de ingesta Emeltec

> **Este archivo se entrega tal cual** a quien tenga que convertir el histórico:
> el proveedor del equipo, el integrador, o una IA. No lo resumas ni lo recortes
> antes de entregarlo — las restricciones que parecen redundantes son las que
> evitan que el histórico entre corrupto.
>
> El runbook interno (prechequeos, carga, refresh de agregados) vive en
> [`import-historico-telemetria.md`](./import-historico-telemetria.md).

---

## Contexto (para que entiendas las restricciones, no para que lo reproduzcas)

El resultado se va a importar a una hypertable TimescaleDB donde cada fila es
**un instante de un equipo**, y todas las variables de ese instante se guardan
pivoteadas en un campo JSONB cuyas claves son los nombres de variable. Las
conversiones de ingeniería (escalas, factores, IEEE754, m³/h→l/s, nivel freático)
se aplican **después**, en la capa de lectura, a partir de una configuración por
sitio.

De ahí salen las dos reglas que no se negocian:

1. Los valores van **crudos, tal cual los entregó el equipo**. Sin escalar, sin
   convertir unidades, sin redondear.
2. Los nombres de variable van **textualmente idénticos** a los del archivo
   origen, porque son la llave de esa configuración.

No eres tú quien decide qué datos se descartan. Tu trabajo es convertir y
**reportar** anomalías, no resolverlas.

---

## Entrada

Vas a recibir uno o más archivos de histórico crudo (export de datalogger, CSV,
TXT, Excel, o dump de base de datos legacy). Puede venir en formato ancho (una
columna por variable) o largo (una fila por lectura). No asumas: inspecciona
primero y describe lo que encontraste antes de convertir.

---

## Salida 1 — `datos.csv` (el entregable principal)

CSV en **formato largo**: una línea por (timestamp, variable).

**Exactamente 6 campos por línea, separados por coma, sin header, sin comillas:**

```
Fecha,Hora,Nombre,Valor,Unidad,Calidad
```

Ejemplo:

```
2026-03-08,00:00:00,Totalizado,430356,m3,G
2026-03-08,00:00:00,Flujo Insta,20.2,l/s,G
2026-03-08,00:00:00,Nivel Freat,73,m,G
2026-03-08,01:00:00,Totalizado,430429,m3,G
2026-03-08,01:00:00,Flujo Insta,20.1,l/s,G
2026-03-08,01:00:00,Nivel Freat,73,m,G
```

### Especificación campo por campo

| # | Campo | Regla |
|---|-------|-------|
| 1 | `Fecha` | **`YYYY-MM-DD`** obligatorio. No uses formatos con slash: son ambiguos y el parser destino interpreta `MM/DD/YYYY`. Si el origen es ambiguo (ej. `03/08/2026`), **detente y pregunta** cuál es el orden; no adivines. |
| 2 | `Hora` | `HH:MM:SS`, 24 h, con ceros a la izquierda. Si el origen no trae segundos, usa `:00`. |
| 3 | `Nombre` | Nombre de variable **copiado literalmente** del origen. Ver reglas abajo. |
| 4 | `Valor` | Numérico, punto decimal. Ver reglas abajo. |
| 5 | `Unidad` | Unidad tal cual venga en el origen. Si el origen no la trae, deja el campo **vacío** (`,,`) — no inventes unidades. |
| 6 | `Calidad` | `G` (dato bueno) o `B` (dato malo/dudoso). Si el origen trae una columna de status/quality/flag, mapéala. Si no trae ninguna, emite `G` en todas las filas y anótalo en el reporte. |

### Zona horaria — CRÍTICO

**Copia la fecha y hora exactamente como están en el origen. NO conviertas a
UTC. NO apliques offsets. NO ajustes horario de verano.**

El pipeline destino asume que la fecha/hora recibida es **hora local de Chile
(`America/Santiago`)** y hace la conversión a UTC él mismo, con manejo de DST. Si
tú también conviertes, el dato queda corrido 3 o 4 horas y el error es silencioso.

Lo único que sí se necesita: en el reporte, indica en qué zona horaria están los
timestamps del origen y cómo lo determinaste. Si el origen está en UTC o en otra
zona, **no lo conviertas** — avisa, y el ajuste se define de este lado.

### Qué variables incluir — TODAS

**Incluye todas las variables que encuentres en el origen, sin seleccionar.**

No es tu decisión cuáles son útiles. El destino guarda cada instante como un
objeto JSONB abierto: sumar variables no cuesta nada, y qué se grafica o qué se
reporta se define **después**, de este lado, a partir del inventario de variables
que tú entregues en el reporte. Volver a pedir el histórico porque faltó una
variable sí es caro.

Concretamente, **no descartes**:

- Variables que parezcan de diagnóstico del equipo: temperatura de gabinete,
  voltaje de batería, señal/RSSI, contadores de reinicio, horómetros.
- Señales digitales, estados de bomba, alarmas, banderas on/off.
- Variables que no entiendas, que no tengan nombre claro, o que estén en blanco
  la mayor parte del tiempo.
- Variables que parezcan duplicadas o redundantes entre sí.

Solo hay **dos excepciones**, y existen para que el histórico quede idéntico a lo
que produce el pipeline en vivo:

- La variable llamada `FREESPACE` (espacio libre en disco del datalogger).
- El valor centinela `-999` / `-999.0` / `-999.000`, que significa "sin dato".
  Se descarta **la lectura**, no la variable.

Ambas se cuentan y se reportan.

### Variables no numéricas

El destino almacena valores numéricos. Si una variable trae valores de texto
(`ON`/`OFF`, `Abierta`/`Cerrada`, códigos de estado alfabéticos):

- **No la conviertas a números por tu cuenta** ni inventes una codificación.
- **No la metas en `datos.csv`** — un valor no numérico aborta el archivo completo
  en la ingesta.
- **No la vuelques entera a `anomalias.csv`.** Si prácticamente todas sus lecturas
  son texto, con mandar un puñado de filas de ejemplo alcanza.
- **Sí documéntala en el reporte** como variable no numérica: nombre textual, la
  lista completa de valores distintos que toma, y cuántas veces aparece cada uno.

Con eso se decide de este lado si se le asigna una codificación numérica o si
queda fuera.

### Nombres de variable — CRÍTICO

- **Copia textual.** Respeta mayúsculas/minúsculas, espacios internos, acentos,
  guiones y abreviaturas.
- **No expandas nombres truncados.** Los dataloggers truncan a ~11 caracteres. Si
  el origen dice `Flujo Insta` o `Nivel Freat`, eso va tal cual: **no** lo
  conviertas a `Flujo Instantáneo` ni `Nivel Freático`.
- **No traduzcas, no normalices, no pases a snake_case, no quites espacios.**
- Solo se permite recortar espacios al inicio y al final del campo.
- Si un nombre de variable **contiene una coma**, no lo sustituyas: repórtalo y
  detente, porque rompe el parser destino.

### Valores — CRÍTICO

- **Punto** como separador decimal. Si el origen usa coma decimal (`20,2`),
  conviértelo a punto (`20.2`).
- **Sin separador de miles.** `430356`, nunca `430.356` ni `430,356`.
- **Sin notación científica.** `0.0000015`, nunca `1.5e-6`.
- **Conserva todos los decimales del origen.** No redondees, no truncues, no
  agregues ceros de relleno. Si el origen dice `548669.188`, va `548669.188`.
- **Sin escalar y sin convertir unidades.** Si el valor viene en m³/h, se queda en
  m³/h. Si viene como entero de registro Modbus sin escala, se queda así.
- No pongas comillas alrededor de nada.
- Si un valor **no es numérico** (`OK`, `ERR`, `NaN`, `---`, vacío): **no lo
  inventes ni lo pongas en `datos.csv`**. Mándalo a `anomalias.csv` y cuéntalo en
  el reporte. Un valor no numérico en `datos.csv` aborta el archivo completo en la
  ingesta. Si la variable **entera** es de texto, ver "Variables no numéricas"
  arriba: va al reporte, no a `anomalias.csv`.

### Reglas de contenido

- **Ordena** ascendente por fecha, luego por hora, luego por nombre de variable.
- **No filtres nada** salvo lo indicado explícitamente aquí. En particular:
  - **No descartes** valores negativos, ceros, valores fuera de rango, saltos
    bruscos, ni retrocesos de totalizador. Repórtalos.
  - **No descartes** filas con `Calidad = B`. Emítelas con su `B`. La decisión de
    excluirlas se toma de este lado.
  - Sí descarta filas cuyo nombre de variable sea `FREESPACE` (es diagnóstico del
    datalogger, no telemetría) y cuéntalas en el reporte.
  - Sí descarta el valor centinela de "sin dato": `-999`, `-999.0`, `-999.000`.
    Cuéntalos en el reporte, desglosados por variable.
- **No interpoles, no rellenes, no completes huecos.** Si a un timestamp le falta
  una variable, esa línea simplemente no existe. Está bien y es esperado.
- **No agregues, no promedies, no cambies la resolución temporal.** Si el origen
  es cada 15 minutos, la salida es cada 15 minutos.
- **Líneas duplicadas idénticas** (mismos 6 campos): deja una sola.
- **Conflictos** — mismo (Fecha, Hora, Nombre) con valores distintos: **saca ambas
  de `datos.csv`** y mándalas a `conflictos.csv`. No elijas ganador.
- Sin líneas vacías, sin línea de totales, sin comentarios, sin separador final
  colgando.

### Codificación y nombre de archivo

- UTF-8 **sin BOM**. Fin de línea LF o CRLF, cualquiera.
- **Un archivo por equipo.** Si el origen mezcla varios equipos/seriales en un
  solo archivo, sepáralos. Nunca los mezcles.
- Nombre: `<IDENTIFICADOR>_LOG_<YYYYMMDD>_<YYYYMMDD>.csv`
  donde `<IDENTIFICADOR>` es el identificador del equipo **tal cual aparece en el
  origen** (serial, nombre de dispositivo, tag) sin espacios, y las dos fechas son
  el primer y último dato del archivo. El segmento `_LOG_` es obligatorio: el
  pipeline lo usa para separar el identificador del resto del nombre.
  Ejemplo: `REGADIO_LOG_20240308_20260812.csv`
- Si un archivo supera ~500 MB o ~5 millones de líneas, pártelo por mes con el
  mismo patrón de nombre y avisa.

---

## Salida 2 — `anomalias.csv`

Mismo formato de 6 columnas, más una séptima con el motivo. Acá van las filas que
excluiste de `datos.csv` por valor no numérico, y cualquier otra exclusión que
hayas tenido que hacer:

```
2026-03-08,04:00:00,Flujo Insta,ERR,l/s,G,valor_no_numerico
```

---

## Salida 3 — `conflictos.csv`

Mismo formato de 6 columnas. Las filas con (Fecha, Hora, Nombre) repetido y
valores distintos, todas las versiones, agrupadas.

---

## Salida 4 — `reporte.md`

Esto es tan importante como el CSV. Se necesita, en texto claro:

1. **Origen**: qué archivos recibiste, formato, tamaño, codificación detectada,
   separador, y si venía ancho o largo.
2. **Equipos**: lista de identificadores encontrados, textual, con cantidad de
   filas de cada uno, y de dónde sacaste el identificador (columna, nombre de
   archivo, header, etc.).
3. **Inventario de variables** — la parte más importante del reporte. Con esta
   tabla se define la configuración del sitio, así que tiene que estar **completa**
   (todas las variables encontradas, sin omitir las que descartaste ni las de
   diagnóstico) y los nombres tienen que ser **textuales**. Una columna por:
   nombre textual, unidad, cantidad de lecturas, mínimo, máximo, promedio, primer
   y último timestamp, y si es numérica o de texto. Marca explícitamente las que
   excluiste de `datos.csv` y por qué.
4. **Rango temporal**: primer y último dato, y la **zona horaria del origen** con
   la evidencia que te llevó a esa conclusión.
5. **Intervalo de muestreo**: el más frecuente detectado (ej. cada 1 h), y si
   cambia a lo largo del histórico, en qué fechas cambia.
6. **Huecos**: períodos sin datos de más de 2 intervalos de muestreo, con fecha de
   inicio, fin y duración. Si son muchos, los 20 más largos más el total.
7. **Conteos de exclusión**: cuántas filas por centinela `-999` (desglosado por
   variable), cuántas `FREESPACE`, cuántas no numéricas, cuántos duplicados
   idénticos colapsados, cuántos conflictos.
8. **Calidad**: cuántas filas con `Calidad = B` y en qué fechas se concentran. Si
   el origen no tenía columna de calidad, dilo explícitamente.
9. **Cosas que deberían preocupar**, sin que las arregles: valores negativos (en
   qué variable y cuántos), retrocesos o reinicios del totalizador con fecha,
   **saltos de escala** (un valor que de golpe se multiplica o divide por 10, 100,
   1000 — indica fecha exacta y factor aparente), valores clavados constantes por
   largos períodos, outliers evidentes.
10. **Decisiones que tomaste y supuestos que asumiste.** Cualquier ambigüedad que
    resolviste sin preguntar, dila acá.

---

## Reglas de trabajo

- **Si algo es ambiguo, pregunta antes de convertir.** Especialmente: orden de
  fecha (día/mes vs mes/día), zona horaria, qué columna es el identificador del
  equipo, y qué columna es la calidad. Un supuesto silencioso acá corrompe el
  histórico entero.
- **No optimices ni "limpies" por iniciativa propia.** Datos sucios reportados
  valen más que datos limpios inventados.
- Procesa el archivo **completo**. No entregues una muestra, un truncado, ni un
  "primeras 1000 filas como ejemplo". Si es grande, pártelo por mes, pero se
  quiere todo.
- Antes de entregar, **valida y reporta el resultado** de estos chequeos:
  - todas las líneas de `datos.csv` tienen exactamente 6 campos
  - ninguna línea tiene comillas, ni comas dentro de un campo
  - todas las fechas parsean como `YYYY-MM-DD` y todas las horas como `HH:MM:SS`
  - todos los valores parsean como número con punto decimal
  - el archivo está ordenado
  - no quedan duplicados idénticos ni conflictos sin resolver
  - la suma de líneas de `datos.csv` + `anomalias.csv` + `conflictos.csv` +
    exclusiones contadas cuadra con las filas del origen
