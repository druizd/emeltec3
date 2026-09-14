# S129 · Pozo 3 Agrosuper — recambio de equipo, septiembre 2026

Expediente del caso. Tercero de la serie, junto con
[s128](./s128-recambio-caudalimetro-2026-09.md) y
[s127](./s127-recambio-caudalimetro-2026-08.md).

**Es el único de los cuatro donde cambió el datalogger completo, no sólo el
caudalímetro**, y el único que al cierre de la revisión no tiene nada mal
configurado: lo que lo detiene es el reloj del equipo.

|                       |                                                             |
| --------------------- | ----------------------------------------------------------- |
| **Sitio**             | `S129` · Pozo 3 · Faenadora San Vicente (Agrosuper, `E113`) |
| **Obra DGA**          | `OB-0601-445`                                               |
| **Serial anterior**   | `151.21.35.27`                                              |
| **Serial nuevo**      | `151.24.16.0`                                               |
| **Instrumento nuevo** | SITRANS FMT020                                              |
| **Periodicidad DGA**  | Horaria, transporte **`shadow`** (no declara)               |
| **Derecho**           | 60 L/s — **sin cargar** al 14-09-2026                       |

## Línea de tiempo

Horas en UTC; entre paréntesis, hora Chile (UTC−4).

| Momento             | Qué pasó                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 30-08 17:00 (13:00) | **El totalizador se congela** en 11.195.961. Es el mismo día en que se recambió el Pozo 2, que terminó a las 12:20 |
| 30-08 → 07-09       | El pozo **sigue bombeando** con el totalizador muerto: el caudalímetro marca 20-54 L/s la mayoría de los días      |
| ~07-09 00:00        | El pozo pasa a `shadow`. Los slots siguientes se acumulan en `pendiente` sin salir                                 |
| 08-09 14:20 (10:20) | Última muestra del datalogger viejo                                                                                |
| 08-09 17:32 (13:32) | **Primer dato del datalogger nuevo** `151.24.16.0`. La primera hora completa es la de las 18:00                    |
| 10-09               | Baja documentada de 181 slots; degradación de los mapeos viejos; cambio de serial; mapeo del equipo nuevo          |
| 14-09               | Corrección del factor, recálculo, verificación independiente                                                       |

## El episodio: nueve días bombeando sin totalizador

`site_contador_mensual` lo muestra sin ambigüedad: el totalizador no avanzó **ni
una cuenta** en septiembre.

| mes         | valor_inicio   | valor_fin      | delta   | muestras   |
| ----------- | -------------- | -------------- | ------- | ---------- |
| 2026-05     | 10.797.347     | 10.889.503     | 92.156  | 44.412     |
| 2026-06     | 10.889.503     | 10.987.005     | 97.502  | 42.969     |
| 2026-07     | 10.987.005     | 11.093.867     | 106.862 | 44.559     |
| 2026-08     | 11.093.867     | 11.195.961     | 102.094 | 44.471     |
| **2026-09** | **11.195.961** | **11.195.961** | **0**   | **10.729** |

Las 10.729 muestras dicen que el equipo viejo **reportaba normal** hasta las
14:20 del 08-09: no fue una caída de comunicación, fue el totalizador.

**Y el pozo no estuvo parado.** El caudalímetro seguía midiendo:

| día   | caudal prom (L/s) | minutos con flujo | `REG372` |
| ----- | ----------------- | ----------------- | -------- |
| 31-08 | 34,8              | 807               | 54.841   |
| 01-09 | 47,8              | 1.113             | 54.841   |
| 02-09 | 54,2              | 1.262             | 54.841   |
| 05-09 | 20,2              | 849               | 54.841   |
| 07-09 | 22,2              | 928               | 54.841   |

Integrando el caudal, son del orden de **23.000 m³ extraídos y no
contabilizados** entre el 31-08 y el 08-09.

De esos, **31 horas alcanzaron a declararse a SNIA con el acumulado congelado**
(01-09 → 07-09) antes de que el pozo pasara a `shadow`. Las 156 restantes
quedaron sin declarar.

### Por qué la validación no lo detuvo antes

El mismo hueco de diseño que en S128: un totalizador congelado en un valor
**alto y sano** no dispara `totalizator_zero` (que sólo mira 0 o NULL), y
`sensor_frozen` tiene una exención para el pozo en reposo. Acá sí disparó
`sensor_frozen` desde el 01-09 —porque el caudal no estaba en cero— y retuvo
143 slots, pero recién después de que 31 salieran con folio.

La señal que lo delataba desde el primer día era el **nivel freático
oscilando** con el bombeo mientras el acumulado no se movía. Nadie cruza esas
dos series.

## Baja de los 181 slots

Rango `30-08 17:00Z` → `08-09 19:00Z`, motivo `recambio_instrumento`. Quedaron
181 `fallido`/`baja_recambio_instrumento` y 37 `enviado` intactos.

El desglose del panel avisó **"saldrían a la DGA: 10 slots"** — los 10
`pendiente` del 07 y 08 de septiembre, que habrían declarado el totalizador
congelado si el pozo volvía a `rest`. Ese aviso es la razón de ser del paso de
resumen previo.

> **El picker del panel interpreta las horas en `Etc/GMT+4`, no en UTC.**
> Escribiendo los valores UTC el rango se consultó 4 h corrido y el resumen
> devolvió 217 slots con 1 `enviado` — que no correspondían a S129 sino a
> **S130**, cuyo rango en esas fechas sí da ese número. El paso de resumen es lo
> que evitó cerrar el Pozo 4 entero con un motivo falso. **Verificar el
> encabezado del pozo antes de aplicar**: las tarjetas de Pozo 3 y Pozo 4 están
> una al lado de la otra y ambas decían "Sin datos".

## El equipo nuevo

### Cada registro con su escala, y ninguna igual a la de los vecinos

| rol         | registros           | transformación | `word_swap` | factor |
| ----------- | ------------------- | -------------- | ----------- | ------ |
| totalizador | `REG3000`+`REG3001` | `ieee754_32`   | **`false`** | 1      |
| caudal      | `REG3002`+`REG3003` | `ieee754_32`   | **`false`** | 1      |
| nivel       | `AI24`              | `lineal`       | —           | 0,1    |

`word_swap: false` es **lo contrario de S127 y S128**, que usan `true`. Copiar la
configuración de un pozo a otro no funciona en esta faena.

### El equipo nuevo repite las claves viejas en cero

`AI23 = 0`, `REG372 = 0`, `REG373 = 0` en cada muestra — justo las que el
`reg_map` tenía mapeadas. Cambiar `sitio.id_serial` antes de mapear los
registros nuevos no habría dejado el pozo "sin datos": lo habría dejado
**declarando ceros**.

Por eso el orden de la intervención importa, y no es el intuitivo:

1. Backfill de contadores **antes** de tocar el serial, mientras el crudo viejo
   sigue alcanzable (todo joinea `equipo.id_serial = sitio.id_serial` en vivo).
2. Degradar los mapeos viejos a `generico` — **antes** del serial, porque
   `listCounterVariables` filtra por rol y el worker horario habría recomputado
   septiembre leyendo `REG372 = 0`, sobrescribiendo la fila recién backfilleada.
3. Recién entonces cambiar el serial: el picker de variables lista las claves
   crudas del serial del sitio, así que los `REG3000-3003` no aparecen en la UI
   hasta ese momento.
4. Mapear.

### Verificación de la escala, sin circularidad

Decodificar el float y compararlo con lo declarado sólo confirma que la
plataforma decodifica bien. La prueba independiente es el **techo de los deltas
horarios**:

```
Avance máximo en 96 horas:  279 m³/h
77,946 L/s × 3,6         =  280,6 m³/h   ✓
```

Si el medidor entregara m³/h el caudal real sería 21,6 L/s = 78 m³/h, y una hora
de 279 m³ sería imposible. **`factor: 1` confirmado.**

El totalizador se verificó además contra el consumo diario: 3.318 m³/día en los
primeros cuatro días, contra los ~3.300 m³/día históricos del medidor viejo.

## El nivel freático es el más estable de los cuatro

| estado    | slots | promedio | rango       |
| --------- | ----- | -------- | ----------- |
| bombeando | 30    | 32,20 m  | 31,4 – 32,4 |
| detenido  | 41    | 23,20 m  | 22,6 – 23,8 |

Rangos separados por 7,6 m y con apenas 1 m de dispersión interna. **Abatimiento
real de 9 m.** El histórico lo respalda: 95 saltos mayores a 5 m entre horas
consecutivas, contra 1.571 de S127.

De paso confirmó la escala del sensor al cambiar el datalogger: con el equipo
viejo `AI24 = 108` daba 31,70 m de nivel; el equipo nuevo entregó `AI24 = 189` →
**23,60 m**, o sea el pozo recuperó 8,1 m en los días detenido. Exactamente lo
que se espera de un pozo en reposo.

## Lo que queda abierto

### El reloj del datalogger va una hora atrasado

`received_at - time` es de **59 minutos constantes**, mientras los seriales
vecinos van a 27 segundos de `now()`. El `time` viene estampado 1 h atrás desde
el payload.

**No es el cambio de hora ni el `Etc/GMT+4` de la plataforma.** El mismo serial
reportaba con desfase de segundos en junio, y el atraso derivó de 59:53 (10-09) a
59:20 (14-09): son 33 segundos en 4 días, o sea un **reloj corriendo libre y
desajustado**, no una configuración de huso. Se arregla poniéndole la hora al
equipo, probablemente en remoto.

**Es el bloqueante para pasar a `rest`**: los 129 slots pendientes saldrían con
la marca temporal corrida, y un `enviado` ya no se corrige.

### El derecho: instantáneo contra medio

|                                       |                              |
| ------------------------------------- | ---------------------------- |
| Caudal **instantáneo**                | **77,9 L/s** — 30% sobre 60  |
| Caudal **medio horario** (218,3 m³/h) | **60,6 L/s** — en el derecho |

El pozo bombea a 77,9 L/s durante ~78% de cada hora. Si la resolución fija el
derecho como caudal **máximo instantáneo**, se excede en 30%; si lo fija como
caudal **medio** o por volumen anual, está prácticamente en el límite exacto.

El caudal es binario —0 o ~77, sin valores intermedios— así que **71 de los 129
slots pendientes superan** el límite de 72 L/s (60 × 1,20). No hay un solo slot
entre 60 y 72.

Cargar el derecho antes de pasar a `rest` deja esos 71 retenidos en
`requires_review`. Cargarlo después los declara y luego activa el control. **Es
una decisión de criterio, no técnica**, y conviene tomarla leyendo la resolución.

### El caudal llega en cero dos de cada tres lecturas

**66,7%** de las lecturas traen `REG3002 = 0` y `REG3003 = 0` mientras el
totalizador avanza. El volumen declarado no está afectado; el caudal
instantáneo sí. Es el mismo cuadro que S127 (53,3%) y S130 (66,0%), y **S128 es
el único limpio (0,0%)** — el único cuyo datalogger trae el remapeo
`REG4000`-`REG4003` del FMT020. **Esa es la configuración a replicar.**

### `AI23` quedó descalibrado

Marca 33,7 L/s contra los 77 reales del Modbus: **2,3× bajo**. El factor 0,1
estaba calibrado para el caudalímetro viejo y el 4-20 mA del nuevo no calza en
ese rango. Está en `generico`, así que no se declara — pero su alias
"Flujometro" contiene el token `flujo` y el resolver lo elegiría si el mapeo
Modbus faltara. **No reactivarlo sin recalibrar.**

En S130, en cambio, el `AI23` quedó bien (57,7 contra 57,5 del Modbus).

## Estado al 14-09-2026

| Verificación             | Estado                                           |
| ------------------------ | ------------------------------------------------ |
| Caudal — escala          | ✅ `factor: 1` confirmado (279 m³/h)             |
| Caudal — integridad      | ⚠️ 66,7% de lecturas en cero — terreno           |
| Totalizador              | ✅ verificado, serie continua 39.806 → 61.028 m³ |
| Nivel freático           | ✅ el más estable de los cuatro                  |
| Mapeos retirados         | ✅ `generico` y sin tokens que puntúen           |
| **Reloj del datalogger** | ❌ **−59 min — bloqueante para `rest`**          |
| Derecho                  | ⬜ decisión pendiente                            |
| 129 slots `pendiente`    | ⬜ listos, esperando el reloj                    |

## Pendientes

### De terreno

- **Corregir el reloj del datalogger** (−1 h). Bloquea el paso a `rest`.
- **Replicar la configuración del datalogger de S128** (remapeo `REG4000`).
- **Recalibrar `AI23`** si alguna vez se quiere volver a usar como respaldo.

### De decisión

- **El derecho**: leer la resolución y definir si 60 L/s es caudal instantáneo o
  medio. De eso depende si se regula la válvula o si basta con cargar el dato.
- **El orden**: pasar a `rest` antes o después de cargar el derecho.

### Ante la DGA

- **31 slots declarados con el acumulado congelado** (01-09 → 07-09), sobre
  ~23.000 m³ extraídos y no contabilizados entre el 31-08 y el 08-09. No se
  puede deshacer desde la plataforma.
