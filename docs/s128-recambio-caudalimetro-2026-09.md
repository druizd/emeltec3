# S128 · Pozo 1 Agrosuper — recambio de caudalímetro, septiembre 2026

Registro del caso. Sirve de expediente para el informe al cliente y de
referencia para los recambios que vienen.

> **Actualizado el 14-09-2026** con una segunda revisión que encontró la
> corrección de unidad **deshecha**. La versión original de este documento
> anticipaba que S129 y S130 traerían "el mismo cuadro": **no lo traen, y
> ninguno de los cuatro se parece al otro** — ver la sección final.

|                       |                                                             |
| --------------------- | ----------------------------------------------------------- |
| **Sitio**             | `S128` · Pozo 1 · Faenadora San Vicente (Agrosuper, `E113`) |
| **Obra DGA**          | `OB-0601-444`                                               |
| **Serial**            | `151.21.35.29`                                              |
| **Instrumento nuevo** | SITRANS FMT020                                              |
| **Periodicidad DGA**  | Horaria, transporte REST                                    |

## Línea de tiempo

Horas en UTC y, entre paréntesis, hora Chile (UTC−4).

| Momento             | Qué pasó                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~01-09              | El totalizador del medidor **viejo** se congela en 4.673.830 m³. Agosto había medido 11.886 m³ (383 m³/día); del 01 al 04 de septiembre midió **9 m³**. El pozo seguía bombeando: el nivel freático oscilaba 2,2 ↔ 5,2 m |
| 04-09 00:49         | El datalogger deja de mandar `AI23`/`REG372-373` y empieza con el bloque `REG3000-3003` del FMT020                                                                                                                       |
| 04-09 05:00 (01:00) | **Última declaración con el medidor viejo.** Caudal 0,019 · totalizador 3.112 m³ · comprobante `wCB5bQTNl956oXlZxHdl9OfbpzBEhxuG`                                                                                        |
| 04-09 05:00–17:00   | El FMT020 está en modo **Totalizer neto**: cuenta en ambos sentidos. El acumulado oscila entre 3.104 y 3.119 m³. **11 slots** quedan sin declarar                                                                        |
| 04-09 ~17:00        | Se corrige a Totalizer directo y se re-basea el acumulado a **214 m³**. Desde acá la serie es monótona                                                                                                                   |
| 04-09 17:00 (13:00) | **Primera declaración válida del medidor nuevo.** Caudal 14,122 L/s · totalizador 214 m³ · comprobante `ZMmrvqSV12WE5aKz5WJxkCOyu13h5pha`                                                                                |
| 06-09               | Diagnóstico completo, corrección de la unidad y del cut-off, recálculo de 55 slots, baja documentada de los 11, y vuelta a `rest`                                                                                        |

**Voucher verificable del dato que reanuda la medición:**

```
https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas?codigoObra=OB-0601-444&numeroComprobante=ZMmrvqSV12WE5aKz5WJxkCOyu13h5pha
```

## El diagnóstico

### El caudal venía en m³/h y se declaraba como L/s

El FMT020 entrega el caudal en **m³/h**, y el mapeo lo guardaba como L/s. Se
declaró **3,6 veces de más**: 51,3 en vez de 14,25 L/s.

Confirmado por tres caminos independientes:

1. **La palabra baja del totalizador.** `REG4000` avanza 7.002 unidades/min con
   flujo y se congela al parar. Con el exponente del float en juego, cada unidad
   vale 2⁻¹³ m³: `7002 × 2⁻¹³ = 0,8547 m³/min = 51,3 m³/h`. Y el caudal marcaba
   51-52.
2. **El techo de los deltas horarios.** En 50 horas ningún delta del totalizador
   superó los 46 m³. Si el caudal fueran 51 L/s (184,6 m³/h), alguna hora lo
   habría superado.
3. **El pulso de la bomba en pantalla.** Dura ~14 min marcando 51,5. A m³/h eso
   son 12 m³; a L/s serían 43. El turno completo marcaba 21 m³ — un solo pulso
   no pudo mover 43.

**Corrección:** en el formulario IEEE754 de la variable, `factor = 1` y
`divisor = 3,6`. El divisor es solo de UI: se pliega a `factor = 0.2777…` al
guardar y al recargar vuelve a mostrar 1, así que **conviene dejar la huella en
el alias** o nadie entiende el 0,2777 después.

### El mapeo estaba bien pareado

Se descartó una hipótesis inicial de palabra baja desalineada y de un registro
faltante (`REG3004`). Los crudos en vivo lo zanjan:

```
REG3000=58754  REG3001=16977  REG3002=31480  REG3003=17550
REG4000=31480  REG4001=16977  REG4002=58754  REG4003=17550
```

Los dos bloques traen las mismas cuatro palabras. El bloque 3000 va
`[baja, alta, baja, alta]` y con `word_swap=true` la palabra alta es `d2`, así
que el mapeo arma bien las dos magnitudes:

```
caudal      = (16977, 58754) = 0x4251E582 = 52,47
totalizador = (17550, 31480) = 0x448E7AF8 = 1.139,8   → dashboard: 1.140 m³ ✓
```

**No hacía falta ampliar la lectura Modbus.** Los retrocesos del totalizador
eran el modo neto, no ruido de decodificación.

### Los caudales negativos eran reales

Deriva del punto de cero del electromagnético, no un error de lectura:
`REG4001 = 48627 = 0xBDF3` → −0,1187, idéntico al valor guardado. La cadena de
lectura es fiel.

Magnitud tras corregir la unidad: **−0,03 a −0,12 L/s**. Disparaban
`flow_negative`, que es bloqueante, y mandaban el **26%** de los slots a
`requires_review`.

**Corrección:** cut-off de caudal bajo en **0,2 L/s** (`parametros.cut_off`),
que es el 1,4% del caudal de trabajo. El corte es simétrico sobre el valor
absoluto: cortar solo los negativos dejaría la serie sesgada hacia arriba y el
promedio en reposo daría positivo en vez de cero.

> Una estimación inicial de 0,066 L/s (dividiendo lecturas viejas por 3,6) quedó
> corta: con datos ya convertidos el ruido llega a 0,12.

### Escala del medidor nuevo, validada

Agosto con el medidor viejo sano: 383 m³/día. Medidor nuevo: 431 m³/día. Mismo
orden de magnitud, así que el totalizador está en m³ y **el re-base de 4.673.830
a 214 es legítimo**. Precedente: S127 saltó de 930.864 a 109.921 el 30-08 y SNIA
lo aceptó.

## La subdeclaración, y por qué ninguna regla la vio

Del 01 al 04 de septiembre se declararon a SNIA **~76 slots con folio** llevando
el totalizador congelado en 4.673.830 y caudal 0. Con ~400 m³/día reales, son
**~1.300 m³ subdeclarados**. Eso **no se puede deshacer** desde la plataforma.

Es un hueco de diseño en la validación, no un flag mal puesto:

- **`totalizator_zero`** solo dispara con 0 o NULL. El valor era 4.673.830, un
  número perfectamente sano.
- **`sensor_frozen`** tiene una exención explícita (`validation.ts:123-124`):
  _"pozo en reposo: caudal ≈ 0 → totalizador plano es normal"_. El caudal viejo
  estaba pegado en 0, así que la regla concluyó "pozo apagado".

**Un pozo con el caudalímetro muerto en 0 y el totalizador congelado en un valor
alto es, para el validador, indistinguible de un pozo apagado.** Declara "sin
extracción" indefinidamente, con folio.

La señal que sí lo delataba era el **nivel freático oscilando** (abatimiento y
recuperación), y nadie la cruza contra el caudal. Queda como pendiente un cruce
**por ventana**: caudal cortado a 0 en N slots seguidos _y_ totalizador
avanzando en todo el rango. Un cruce slot a slot sería una máquina de falsos
positivos, porque con la bomba ciclando en minutos el caudal instantáneo es 0
muy seguido mientras la hora sí acumuló volumen.

## Estado al cierre del 06-09-2026

|                    |                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Caudal declarado   | **14,1 L/s** (era 51,5)                                                                       |
| Negativos          | **cero** en los 58 slots del tramo nuevo                                                      |
| Totalizador        | monótono desde el re-base                                                                     |
| Roles duplicados   | `AI23` y `REG372/373` des-roleados a `generico`, con los 37 meses de Flujo Mensual intactos   |
| Tramo en modo neto | 11 slots dados de baja, `fail_reason = baja_manual_rango`, con autor y motivo en la auditoría |
| `dga_transport`    | `rest`                                                                                        |

**Decisión de criterio:** el slot del `03-09 08:00 UTC` (04:00 Chile) quedó
`pendiente` con `network_error` y **se envía, no se da de baja**. Tiene valores,
pasó la validación y solo falló por un timeout de red; sus vecinos salieron con
el mismo totalizador congelado. Un hueco de una hora es peor que una declaración
con un medidor que después resultó malo, y la subdeclaración es un problema
aparte que no se arregla omitiendo una hora más.

## Lo que este caso dejó en la plataforma

| PR   | Qué                                                                    |
| ---- | ---------------------------------------------------------------------- |
| #202 | Cut-off de caudal bajo configurable por variable                       |
| #203 | Operación ya no se dibuja debajo de un panel abierto                   |
| #204 | Mapeos huérfanos y rol duplicado visibles en la web                    |
| #205 | Layout, información y accesibilidad de esos avisos                     |
| #206 | Formato `DD/MM/YYYY HH:MM` de la última muestra                        |
| #207 | Recalcular y dar de baja slots por rango                               |
| #208 | Modal con fondo desenfocado y gate SuperAdmin/Admin                    |
| #209 | Hotfix: recalcular devolvía 500 por un `NULL` en `validation_warnings` |
| #210 | Desglose que responde "qué sale a la DGA" y bajas tipificadas          |

Ver [dga-mantenimiento-slots.md](./dga-mantenimiento-slots.md).

## Segunda revisión — 14-09-2026

Auditoría valor por valor antes de dejar los cuatro pozos declarando solos.
S128 se revisó dos veces: la primera pasada lo dio por bueno y **estaba mal**.

### El factor volvió a 1 y nadie lo notó

A las **04:58:36 UTC del 14-09** el `factor` del caudal pasó de `0.2777…` a
**`1`**, deshaciendo la corrección de este mismo documento. El pozo está en
`rest`: el slot de las 05:00 salió a SNIA con **51,661 L/s** en vez de 14,3.

Un solo slot afectado — se detectó dentro de la hora—, pero la causa importa
más que el daño:

- **El divisor es sólo de UI.** Se pliega a `factor = 0.2777…` al guardar y al
  recargar la pantalla vuelve a mostrar `1`. Quien abre la variable ve un
  factor raro y sin explicación, y la corrección se lee como el error.
- **S127 y S128 son casos opuestos con el mismo número.** El mismo día se
  corrigió S127 quitándole un `0.2778` que no correspondía (su medidor entrega
  L/s directo, ver [[s127-factor-caudal-036-164-slots-snia]] en la memoria del
  proyecto). Aplicar ese criterio a S128 por analogía es exactamente lo que
  pasó, y es un error: **acá el `0.2778` es la corrección, no la falla.**

**Mitigación:** el alias quedó como **`Caudal (m3/h ÷3,6)`**. La huella en el
nombre es lo único que sobrevive al round-trip de la UI.

> **Cómo verificar la unidad sin caer en el mismo error.** Decodificar el float
> y compararlo contra el valor declarado **no prueba nada**: confirma que la
> plataforma decodifica bien, no que la unidad sea la correcta. La prueba
> independiente es el **techo de los deltas horarios** — con 14,3 L/s
> (51,5 m³/h) y pulsos de ~14 min, los avances caen entre 5 y 41 m³/hora, que
> es justo lo observado; con 51,6 L/s (185,8 m³/h) alguna hora habría superado
> los 46 m³ y en 50 horas ninguna lo hizo.

### El remapeo `REG4000` es la configuración que funciona

S128 es el **único de los cuatro pozos** cuyo datalogger trae el bloque
`REG4000`-`REG4003` además del `REG3000`-`REG3003` — el remapeo del FMT020
(menú 10448+). Son las mismas cuatro palabras con los pares intercambiados:

```
REG3000=48425  REG3001=16973  REG3002=1160   REG3003=17791
REG4000=1160   REG4001=16973  REG4002=48425  REG4003=17791
```

Y es el único que lee **sin ceros**. Comparación sobre 6 horas de crudo:

| pozo     | lecturas de caudal en cero | registros del caudal |
| -------- | -------------------------- | -------------------- |
| S127     | 53,3 %                     | `REG3003`+`REG3004`  |
| **S128** | **0,0 %**                  | `REG3000`+`REG3001`  |
| S129     | 66,7 %                     | `REG3002`+`REG3003`  |
| S130     | 66,0 %                     | `REG3002`+`REG3003`  |

En los otros tres, entre **la mitad y dos tercios** de las lecturas de caudal
llegan en cero mientras el totalizador avanza. Como el caudal declarado es la
muestra puntual del minuto del slot, hay esa misma probabilidad de declarar 0 en
una hora con bombeo. **El totalizador no tiene el problema**, así que el volumen
declarado es correcto y sólo el caudal instantáneo está sucio.

Una hipótesis de que fallara "lo que va segundo en la secuencia de lectura"
quedó **descartada**: en S128 el segundo par también lee limpio. La diferencia
está en la configuración del datalogger, y **S128 es la referencia a replicar en
los otros tres.**

### Valores verificados

Crudo de las 05:36 UTC, `word_swap: true`:

| magnitud    | registros           | hex          | decodificado                   | declarado |
| ----------- | ------------------- | ------------ | ------------------------------ | --------- |
| Caudal      | `REG3000`+`REG3001` | `0x424DBD29` | 51,40 **m³/h** → **14,28 L/s** | 14,2 ✓    |
| Totalizador | `REG3002`+`REG3003` | `0x457F0488` | **4.080,4 m³**                 | 4.065 ✓   |

Nivel: `AI24` 299 × 0,1 = 29,9 m de columna sobre un sensor a 35 m →
**5,1 m** desde superficie. Correlaciona con el bombeo (5,1 m bombeando contra
2,0 m en reposo, 3 m de abatimiento).

La razón caudal-declarado / caudal-implícito-en-el-totalizador daba **1,28** y
parecía un error de escala. No lo es: el pozo bombea en pulsos de ~10-14 min, así
que la muestra puntual y el promedio horario no tienen por qué parecerse. El caso
más claro es que **la hora con el caudal declarado más alto tuvo menos volumen**:

| hora  | caudal declarado | avance real | promedio real |
| ----- | ---------------- | ----------- | ------------- |
| 05:00 | 51,7 (mal)       | 28 m³       | 7,8 L/s       |
| 04:00 | 14,2             | 41 m³       | 11,4 L/s      |

### Limpieza aplicada

| Qué                                | Detalle                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tres mapeos llamados "Totalizador" | `RM59830E7B` → `REG372 retirado`, `RM788C4B4D` → `REG373 retirado`. Con rol `generico` y alias "Totalizador" puntuaban **110** contra los **90** del ieee754 vivo; no ganaban sólo porque esas claves ya no llegan en el crudo |
| `sensor_known_defective`           | Removido de `RM59830E7B`. Describía el medidor **retirado** el 04-09 y suprime `totalizator_zero`                                                                                                                              |
| `cut_off`                          | 0,2 → **0,5 L/s**, unificado con los otros tres pozos                                                                                                                                                                          |
| `dga_caudal_max_lps`               | **45 L/s** cargado. Con tolerancia 20 % el límite es 54; el caudal real de 14,3 queda muy holgado                                                                                                                              |

## Pendientes

### De terreno

- **Flujo inverso sostenido.** Entre -0,8 y -3,9 L/s durante **horas seguidas**,
  con el patrón `0 → -1,7 → -2,4 → -3,9 → -3,1 → 14,1`. No es la deriva del
  cero (esa es de ±0,12 y la corta el cut-off) ni un transiente de parada:
  es agua corriendo hacia atrás, probable **válvula de retención que no cierra**.
  Tiene costo real — agua perdida y desgaste de bomba—, así que **no** hay que
  taparlo subiendo el cut-off.
- **Replicar la configuración del datalogger de S128** (remapeo `REG4000`) en
  S127, S129 y S130, para que dejen de leer la mitad de los caudales en cero.

### De plataforma

- **El empate en Flujo Mensual.** `getMonthlySeries` indexa por mes con
  `map.set` sobre un `ORDER BY mes ASC` **sin desempate**, y
  `upsertContadorMensual` no tiene guard contra `muestras = 0`. Con dos
  variables del mismo rol en el mismo mes el ganador es no determinista: agosto
  desaparece del gráfico. Afecta a S127 y S128. **No está arreglado.**
- **El divisor de la UI no sobrevive al round-trip** y por eso se revirtió el
  factor el 14-09. Mientras no se arregle, la huella va en el alias.
- **El bono uint32 del resolver se gana por alias.** Un mapeo retirado con rol
  `generico` pero alias "Totalizador" sigue puntuando 110 contra los 90 del
  medidor vivo, porque con rol `generico` la clave se deriva del alias. El
  arreglo de fondo es mover el chequeo de `ok` antes del bono; mientras tanto,
  **al retirar un mapeo hay que sacarle el rol y también el nombre**. Pasó en
  S127, S128, S129 y S130.
- El cruce por ventana descrito arriba, para detectar un caudalímetro muerto sin
  falsos positivos.
- **El caudal instantáneo que se declara es una muestra puntual** y en estos
  pozos, que bombean en pulsos de 10-15 min, no representa el caudal medio de la
  hora. Es correcto según el manual DGA, pero conviene tenerlo presente al
  interpretar las declaraciones.

### Resueltos desde la primera versión

- ~~`dga_caudal_max_lps` NULL en los cuatro~~ → derechos conocidos el 14-09
  (**S128 45 L/s · S127, S129 y S130 60 L/s**); cargado en S128, pendiente en
  los otros tres. Ojo con **S129: bombea sostenido a 77 L/s sobre un límite de
  72**.
- ~~S129 y S130 traen el mismo cuadro de unidades~~ → **no lo traen, y ninguno
  se parece al otro.** S127 entrega L/s directo (factor 1); S129 también; S130
  entrega el caudal en m³/h (factor 0,2778) **y el totalizador en litros**
  (factor 0,001), las dos escalas en el mismo medidor. **No hay un factor "de la
  marca": hay que medir cada registro contra el otro en el mismo equipo.**
