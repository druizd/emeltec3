# Importar histórico de telemetría cruda (nuevo sitio)

Runbook para cargar el histórico de un sitio recién incorporado a la plataforma:
los datos que el equipo ya venía registrando antes de estar conectado a Emeltec
Cloud.

Aplica a **telemetría cruda** (tabla `equipo`, gráficos de operación, contadores,
análisis). Para el histórico **regulatorio DGA** ya declarado a SNIA — otro
formato y otro destino (`dato_dga` + `dga_send_audit`) — usar
`main-api/scripts/import-dga-historico.js`.

Documento hermano: [`import-historico-telemetria-BRIEF.md`](./import-historico-telemetria-BRIEF.md)
es el brief que se entrega a quien convierte el archivo. Se manda tal cual.

Pipeline de ingesta normal y datos de servidores: [`ftp-pipeline.md`](./ftp-pipeline.md).

---

## 1. Destino y por qué el formato es el que es

```sql
equipo (time TIMESTAMPTZ, id_serial VARCHAR(50), data JSONB, received_at TIMESTAMPTZ)
-- hypertable, chunks de 1 día, compresión automática a los 7 días
```

Una fila por **instante por equipo**. Todas las variables de ese instante van
pivoteadas en `data`:

```json
{"Totalizado": 430356, "Flujo Insta": 20.2, "Nivel Freat": 73}
```

Dos consecuencias que gobiernan todo el resto del procedimiento:

**Los valores se guardan crudos.** Las conversiones de ingeniería (IEEE754,
factor/offset, `uint32` de dos registros, m³/h→l/s, nivel freático a partir de
profundidad de sensor) se aplican **en lectura**, desde `reg_map.transformacion` +
`reg_map.parametros` — fuente única en `main-api/src/utils/mappingTransform.js`.
Si el archivo llega ya escalado, el dato queda doble-escalado y el error es
silencioso.

**Las claves de `data` son `reg_map.d1`.** Es el nombre de variable literal del
datalogger. Cualquier normalización cosmética (expandir `Flujo Insta` a
`Flujo Instantáneo`, pasar a snake_case, quitar espacios) rompe el mapeo y la
variable deja de graficarse, sin error.

---

## 2. Formato canónico del archivo

Es el mismo formato raw que consume el pipeline FTP productivo
(`ftp-pipeline/ftpprocessor/internal/ftpreader/reader.go`), así que el histórico
entra por el mismo camino que los datos en vivo, sin código nuevo.

Formato **largo**, 6 campos por línea, sin header:

```
Fecha,Hora,Nombre,Valor,Unidad,Calidad
2026-03-08,00:00:00,Totalizado,430356,m3,G
2026-03-08,00:00:00,Flujo Insta,20.2,l/s,G
2026-03-08,00:00:00,Nivel Freat,73,m,G
```

Lo que el parser hace con eso:

| Aspecto | Comportamiento |
|---|---|
| Separador | Coma, `;` o tab, autodetectado. Deben ser **exactamente 6** campos. |
| Fecha | Acepta `YYYY-MM-DD`, `DD-MM-YYYY`, `YYYY/MM/DD` y `MM/DD/YYYY`. **Exigimos ISO** — la forma con slash se interpreta mes primero y es una trampa. |
| Hora | `HH:MM:SS`. |
| Zona horaria | Se interpreta como **hora local Chile** y se convierte a UTC con `America/Santiago`, con DST. En BD queda UTC. El archivo **no** debe venir convertido. |
| Decimal | Punto o coma, se normaliza a punto. |
| `Nombre` | Va como clave de `data`. `FREESPACE` se descarta. |
| `Valor` | Debe ser numérico. **Un valor no numérico aborta el archivo completo** → va a `hold_corrupt` tras 3 intentos. |
| Centinela | `-999`, `-999.0`, `-999.000` → esa variable se omite en ese timestamp. |
| `Unidad` | Se lee y se ignora. |
| `Calidad` | **El parser NO la filtra.** Filtrar antes si se quiere excluir `B`. |
| Líneas ignoradas | Las que empiezan con `:` o con un carácter no numérico (headers, trailer `:YN … :SN …`). |
| Agrupación | Todas las filas con igual (serial, fecha, hora) → una sola fila de `equipo`. |
| `id_serial` | **Sale del nombre del archivo, no de una columna.** |

**Nombre de archivo:** `<IDENTIFICADOR>_LOG_<YYYYMMDD>_<YYYYMMDD>.csv`

El segmento `_LOG_` es obligatorio: el serial es todo lo que va antes. Sin él, el
serial queda siendo el nombre completo del archivo y no resuelve.

```
✓ REGADIO_LOG_20240308_20260812.csv   → serial = REGADIO
✗ REGADIO_marzo2024.csv               → serial = REGADIO_marzo2024
```

---

## 3. Orden de las tareas: las variables se definen DESPUÉS

El orden importa y es contraintuitivo. Las variables las trae el origen, no las
elegimos nosotros: en un sitio nuevo **no sabemos los nombres hasta que llega el
reporte de conversión**. Por eso `reg_map` se define a partir del inventario de
variables del reporte, no antes.

```
1. Prechequeos que NO dependen de las variables (sitio + serial + alias)
2. Entregar el BRIEF → recibir datos.csv + reporte.md
3. Definir reg_map desde el inventario de variables del reporte
4. Cargar
```

El brief pide **todas** las variables del origen, no solo las que vamos a usar.
`equipo.data` es un JSONB abierto: guardar variables extra no cuesta nada y no
molesta a nada. Una variable cargada y sin `reg_map` simplemente no se muestra, y
mapearla más tarde es un `INSERT` en `reg_map` — **no requiere recargar el
histórico**. Al revés sí duele: pedir de nuevo el histórico porque faltó una
variable es caro, y recargar con `data` distinta duplica filas (ver §4).

### 3.1 Prechequeos previos a la conversión

1. **El sitio existe** y su `sitio.id_serial` es el serial real del equipo.

   ```bash
   docker exec emeltec-db psql -U postgres -d telemetry_platform \
     -c "SELECT id, descripcion, id_serial FROM sitio WHERE id = 'SXXX';"
   ```

2. **`DEVICE_ALIASES`** en el `.env` del ftpprocessor mapea el nombre del archivo
   al `id_serial`, si no coinciden. Formato `NOMBRE:serial`, separado por comas.
   Sin la entrada, las filas entran con el nombre como serial y quedan huérfanas.

### 3.2 Definir `reg_map` desde el reporte (después de la conversión)

3. Tomar el **inventario de variables** del `reporte.md` y crear un `reg_map` por
   cada variable que se vaya a mostrar, con `d1` = el nombre **textual** de la
   variable, copiado del inventario carácter por carácter.

   ```bash
   docker exec emeltec-db psql -U postgres -d telemetry_platform \
     -c "SELECT alias, d1, d2, transformacion, parametros, unidad FROM reg_map WHERE sitio_id = 'SXXX' ORDER BY alias;"
   ```

   No hace falta mapear todas de entrada: las que queden sin `reg_map` siguen
   guardadas en `data` y se pueden mapear cuando se necesiten.

4. **Elegir la transformación y los parámetros correctos para el período
   histórico.** Los rangos min/max/promedio del inventario son la evidencia: si el
   caudal máximo del histórico es 377 l/s en un pozo que normalmente da 37, la
   escala está mal en algún lado y hay que resolverlo **antes** de cargar.
   `reg_map` tiene un solo juego de parámetros por variable y se aplica a todo el
   histórico por igual — si el factor del equipo cambió en el tiempo, no hay forma
   de expresarlo y el tramo viejo o el nuevo va a quedar mal.

5. Si el inventario trae **variables no numéricas** (estados de texto), decidir
   acá: o se les asigna una codificación numérica y se pide reconvertir esa
   variable, o quedan fuera del histórico. No entran como texto.

---

## 4. Carga

El `ftpprocessor` corre en el **Windows Server** (no está en `docker-compose.yml`).
Rutas y accesos en [`ftp-pipeline.md`](./ftp-pipeline.md).

1. Recibir `datos.csv` + `reporte.md` y revisar el reporte **antes** de cargar
   nada. Los saltos de escala, retrocesos de totalizador y huecos se deciden acá,
   no después.

2. Decidir los filtros que el brief deliberadamente no aplicó. Para filtrar por
   mes, calidad `G` y timestamps con todos los sensores presentes:

   ```powershell
   .\ftp-pipeline\filter-ftp-month.ps1 `
     -InputFile "C:\ruta\SITIO_LOG_20240308_20260812.csv" `
     -OutputFile "C:\serverwin\SITIO_LOG_20240301_20240331.csv" `
     -Year 2024 -Month 3 -RequireAllSensors
   ```

3. Copiar el archivo a `INPUT_DIR` del ftpprocessor
   (`…\ftpprocessor\bin\data\incoming_ftp\`).

4. Confirmar en el log: `ok ftp (SERIAL) archivo.csv | attempt 1/3 | records: N`.
   Si aparece `corrupt … movido a hold_corrupt`, hay un valor no numérico o una
   línea con distinto número de campos.

5. **Cargar de a un mes o un año por vez**, verificando entre tandas. Un histórico
   de años en un solo archivo hace lento el diagnóstico si algo sale mal.

### Idempotencia

`equipo` **no tiene unique constraint**. La deduplicación la hace el ftpconsumer
al insertar, con `WHERE NOT EXISTS` sobre la terna `(time, id_serial, data)`
(`ftp-pipeline/ftpconsumer-rust/src/main.rs:90`).

- Reejecutar **el mismo archivo** es seguro: no duplica.
- Un archivo con el **mismo timestamp y `data` distinta** (aunque cambie una sola
  variable) **sí inserta una fila nueva**. Reconvertir un histórico con un filtro
  distinto y recargarlo duplica.

Ante la duda, verificar antes de recargar:

```bash
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
SELECT time, count(*) FROM equipo
WHERE id_serial = 'SERIAL' AND time >= 'YYYY-MM-01' AND time < 'YYYY-MM-01'::date + interval '1 month'
GROUP BY time HAVING count(*) > 1 ORDER BY time LIMIT 20;"
```

---

## 5. Post-carga (sin esto el histórico no se ve)

### 5.1 Refrescar los continuous aggregates

El frontend lee `equipo_1min` / `equipo_5min` / `equipo_hourly` / `equipo_daily`,
no la tabla cruda. Las refresh policies solo cubren ventanas recientes
(`start_offset` 7 d / 30 d / 90 d / 3 años), así que **un histórico más viejo que
eso no aparece hasta refrescar a mano** el rango cargado:

```bash
docker exec -i emeltec-db psql -U postgres -d telemetry_platform <<'EOF'
CALL refresh_continuous_aggregate('equipo_1min',   '2024-03-01', '2024-04-01');
CALL refresh_continuous_aggregate('equipo_5min',   '2024-03-01', '2024-04-01');
CALL refresh_continuous_aggregate('equipo_hourly', '2024-03-01', '2024-04-01');
CALL refresh_continuous_aggregate('equipo_daily',  '2024-03-01', '2024-04-01');
EOF
```

Refrescar **rango por rango**, no con `NULL` de inicio: un refresh sobre todo el
histórico bloquea por minutos.

### 5.2 Chunks comprimidos

`equipo` comprime a los 7 días y el chunking es **solo por tiempo**: los chunks de
fechas viejas ya existen y están comprimidos, aunque el equipo sea nuevo. Insertar
histórico cae sobre chunks comprimidos.

TimescaleDB 2.11+ lo soporta (las filas nuevas van a la región sin comprimir del
chunk), pero es notablemente más lento y deja el chunk parcialmente descomprimido.
Confirmar versión antes de una carga grande:

```bash
docker exec emeltec-db psql -U postgres -d telemetry_platform \
  -c "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';"
```

Si la carga es de millones de filas, conviene descomprimir el rango, cargar, y
recomprimir después.

---

## 6. Verificación final

```bash
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
SELECT count(*) AS filas, min(time) AS desde, max(time) AS hasta,
       count(DISTINCT date_trunc('day', time)) AS dias
FROM equipo WHERE id_serial = 'SERIAL';"
```

Y que las claves de `data` sean las esperadas:

```bash
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
SELECT DISTINCT jsonb_object_keys(data) AS variable
FROM equipo WHERE id_serial = 'SERIAL' AND time > 'YYYY-MM-DD' ORDER BY 1;"
```

Cruzar esa lista contra los `d1` de `reg_map` del paso 3, en los dos sentidos —
pero los dos desbalances significan cosas distintas:

- **Clave en `data` sin `reg_map`**: esperado y correcto. Es una variable cargada
  que todavía no se muestra. Se mapea cuando se necesite, sin recargar nada.
- **`d1` en `reg_map` sin clave en `data`**: esto sí es un problema. O el nombre se
  escribió distinto (un espacio, una tilde, mayúscula), o la variable no vino en el
  archivo. Revisar contra el inventario del reporte antes de dar la carga por
  buena.

Por último, abrir la vista de operación del sitio en el frontend y confirmar que
los gráficos históricos muestran el rango cargado con valores de magnitud
plausible — es el único chequeo que valida que las transformaciones de `reg_map`
son las correctas.

---

## 7. Registro

Anotar cada carga en la sección **Datos cargados** de
[`ftp-pipeline.md`](./ftp-pipeline.md): sitio, serial, período, filas insertadas,
rango UTC resultante y filtros aplicados.
