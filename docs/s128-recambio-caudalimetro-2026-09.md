# S128 · Pozo 1 Agrosuper — recambio de caudalímetro, septiembre 2026

Registro del caso. Sirve de expediente para el informe al cliente y de
referencia para los recambios que vienen: **S129 y S130 probablemente traen el
mismo cuadro**.

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

## Estado final

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

## Pendientes

- **El empate en Flujo Mensual.** `getMonthlySeries` indexa por mes con
  `map.set` sobre un `ORDER BY mes ASC` **sin desempate**, y
  `upsertContadorMensual` no tiene guard contra `muestras = 0`. Con dos
  variables del mismo rol en el mismo mes el ganador es no determinista: agosto
  desaparece del gráfico. Afecta a S127 y S128. **No está arreglado.**
- **`dga_caudal_max_lps` es NULL en los cuatro pozos de Faenadora.** Sin derecho
  cargado la validación de caudal cae al fallback duro de 1000 L/s. Falta pedir
  las resoluciones DGA.
- **S129 y S130** probablemente traen el mismo cuadro de unidades m³/h → L/s.
- El cruce por ventana descrito arriba, para detectar un caudalímetro muerto sin
  falsos positivos.
