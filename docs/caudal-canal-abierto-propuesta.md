# Caudal en canal abierto: de nivel a metros cúbicos

Propuesta. Nada de esto está implementado.

Gatillado por el flume Palmer-Bowlus de 4" de Doñihue, del que hoy llega sólo
el nivel. El objetivo es que ese nivel termine siendo un volumen mensual en m³
que el balance de RILes pueda usar sin saber de dónde salió.

---

## 1. De dónde se parte

Lo que hay hoy en terreno:

- Un flume Palmer-Bowlus de 4" con su tabla de descarga (Isco Open Channel Flow
  Measurement Handbook, 6ª edición, vía OpenChannelFlow).
- Un nivel de agua llegando a la plataforma.

Lo que hay hoy en la plataforma:

- Transformaciones `directo`, `bit`, `lineal`, `lineal_int16`, `ieee754_32`,
  `uint32_registros`, `nivel_freatico` y `caudal_m3h_lps`. Todas lineales o de
  formato. Hay un caso `formula`, pero lanza
  `transformacion formula aun no esta habilitada`.
- Contadores que leen **acumuladores monótonos**:
  `computeMonthDeltaForVariable` toma un totalizador, detecta resets y suma
  segmentos positivos. No existe ningún camino que integre un caudal en el
  tiempo.

O sea: con lo que hay, el nivel del flume no puede convertirse en volumen.
Faltan dos piezas, y son independientes entre sí.

---

## 2. El error de la ficha, antes que nada

La ficha del fabricante trae dos fórmulas métricas:

```
L/S    = 468.34 · Hm^1.9
M3/HR  = 1647.88 · Hm^1.9
```

**No pueden ser ambas correctas**, porque m³/h es exactamente 3,6 veces L/s, y
`1647.88 / 468.34 = 3,519`.

Contrastando contra la tabla del propio documento, a fondo de escala
(H = 0,0762 m; tabla: 3,435 L/s y 12,36 m³/h):

| Fórmula            | Resultado   | Tabla | Error |
| ------------------ | ----------- | ----- | ----- |
| `1647.88 · Hm^1.9` | 12,374 m³/h | 12,36 | 0,1%  |
| `468.34 · Hm^1.9`  | 3,517 L/s   | 3,435 | 2,4%  |

La ficha declara que sus fórmulas ajustan dentro del **1% del fondo de escala**.
La de m³/h cumple; la de L/s no cumple su propia promesa.

La constante correcta para L/s es **457,74** (= 1647,88 / 3,6). Verificado
también por el otro camino: la fórmula en pies, `1.68 · Hft^1.9`, da 0,0210 CFS
a 0,10 ft —exactamente lo tabulado— y esos 0,0210 CFS son 0,5947 L/s, también
exactamente lo tabulado.

**Usar el 468,34 de la ficha inflaría todo el caudal un 3%.** El valor va a
`parametros`, así que el que se cargue queda escrito y auditable; esto existe
para que nadie copie el número malo mirando el PDF.

---

## 3. Pieza 1 — la transformación de potencia

`Q = C · Hⁿ` no es la fórmula del Palmer-Bowlus: es la forma de casi todo
dispositivo de canal abierto. Por eso la transformación es genérica y no se
llama `palmer_bowlus`.

| Dispositivo           | n                          |
| --------------------- | -------------------------- |
| Palmer-Bowlus 4"      | 1,9                        |
| Parshall              | ~1,52 a 1,6 según garganta |
| Vertedero triangular  | 2,5                        |
| Vertedero rectangular | 1,5                        |

Transformación nueva: **`caudal_potencia`**, con salida en **L/s** (la unidad de
caudal del resto de la plataforma).

Encadena igual que `nivel_freatico`, que ya hace exactamente este patrón:
primero `applyLinearTransform(applySignedParam(rawD1, params, 16), params)` para
llevar el crudo a nivel en metros con el factor y offset de siempre, y recién
sobre ese nivel aplica la física.

Parámetros nuevos en `parametros`:

| Parámetro     | Qué es                                   | Palmer-Bowlus 4" |
| ------------- | ---------------------------------------- | ---------------- |
| `coeficiente` | C de la ley de potencia                  | 457.74           |
| `exponente`   | n                                        | 1.9              |
| `nivel_min_m` | Bajo esto el dispositivo no es confiable | 0.0183           |
| `nivel_max_m` | Fondo de escala del dispositivo          | 0.0762           |

### Las tres decisiones que el cálculo no debe adivinar

**Bajo `nivel_min_m` no se devuelve cero.** En el umbral del Palmer-Bowlus de 4"
el caudal es 0,2436 L/s, no cero: recortar a cero inventaría una discontinuidad
y perdería caudal real. La ley de potencia es continua y se sigue aplicando; lo
que se agrega es una marca de fuera de rango.

Para el ruido del cero ya existe el `cut_off` de la plataforma, que es **opt-in**
y aquí se aplicaría **sobre el nivel**, no sobre el caudal. Quien lo prenda está
eligiendo subestimar a cambio de no acumular ruido, y eso debe ser una decisión
explícita y no un default.

**Sobre `nivel_max_m` no se extrapola en silencio.** Un flume de 4" topa en
3,435 L/s. Si el nivel supera el fondo de escala, el número deja de significar
algo y el período tiene que quedar marcado, no completado con una extrapolación
que la curva no respalda.

**La sumergencia no se puede detectar.** El Palmer-Bowlus trabaja en descarga
libre hasta 85% de sumergencia; pasado eso la curva no aplica. Con sólo el nivel
aguas arriba **no hay forma de saberlo desde el software**. Es un límite físico
de la instalación y va documentado, no resuelto.

---

## 4. Pieza 2 — de caudal a volumen

Es la pieza que hoy no existe en ninguna parte del sistema, y la que el balance
de RILes realmente necesita.

**Método: trapecio entre muestras consecutivas.**

```
V += (Q_i + Q_i+1) / 2 · Δt
```

Con L/s y Δt en segundos el resultado son litros; dividido por 1.000, m³.

La fuente son los buckets de `equipo_1min`, que es de donde ya leen los
contadores. Para estos sitios el datalogger reporta ~1 muestra por minuto, así
que Δt es típicamente 60 s.

### La decisión que define si el número es honesto

**Un hueco de comunicación no se puentea.** Si entre dos muestras pasan más de
`GAP_MAX` (propuesto: 15 minutos), no se integra ese tramo: se cuenta como
faltante y el período queda marcado incompleto.

Es la misma decisión que ya tomó RILes en la fase 1 —_período sin lecturas →
null marcado incompleto, nunca cero_— y por el mismo motivo. Puentear un hueco
de seis horas con el trapecio produce un volumen que nadie midió, indistinguible
de uno real. Un totalizador de verdad no tiene este problema: sigue contando
aunque se caiga el enlace, y por eso siempre será preferible.

### Dónde se guarda

En `site_contador_diario` y `site_contador_mensual`, las mismas tablas de los
contadores, con:

| Columna             | Qué lleva                               |
| ------------------- | --------------------------------------- |
| `delta`             | el volumen integrado                    |
| `unidad`            | `m3`                                    |
| `muestras`          | cuántas muestras entraron a la integral |
| `valor_inicio/fin`  | null — no hay acumulador que leer       |
| `resets_detectados` | 0 — no aplica                           |
| `rol`               | `volumen_integrado`                     |

El `rol` propio es a propósito: la variable en `reg_map` sigue siendo de rol
`caudal`, porque lo que llega **es** un caudal y el dashboard debe mostrarlo
como tal. Lo que se materializa es otra cosa, y mezclarlo con `totalizador`
haría imposible distinguir después un volumen medido de uno integrado.

---

## 5. Qué tan bueno es el número

La pregunta que importa: ¿se puede estimar el acumulado en m³? **Sí**, y con
una precisión razonable — pero el límite no lo pone la matemática.

**Lo que aporta poco error:**

- _La integración_. Con muestras de 1 minuto sobre un caudal que varía
  suavemente, el error del trapecio es despreciable frente a todo lo demás.
- _El ajuste de la ley de potencia_. La ficha declara 1% del fondo de escala, y
  contra la tabla se verifica.

**Lo que aporta el error de verdad:**

- _El flume y su instalación_. La precisión de un Palmer-Bowlus bien instalado
  ronda el ±3% del caudal. Mal nivelado, con aproximación insuficiente aguas
  arriba o con sumergencia, es mucho peor y nada de eso se ve desde el software.
- _El sensor de nivel_. Su error se amplifica: como `Q ∝ H^1,9`, un 1% de error
  en el nivel es ~1,9% en el caudal. **El nivel es el número crítico.**
- _Los huecos de comunicación_. No agregan error al volumen calculado, pero
  reducen el período efectivamente medido — por eso se marcan en vez de
  rellenarse.

**Conclusión honesta:** el acumulado va a ser una estimación con un error de
varios por ciento, dominado por el instrumento y su instalación, no por el
cálculo. Sirve perfectamente para un balance hídrico, para ver tendencias y
para detectar desvíos. **No es equivalente a un totalizador** y no debe
presentarse como tal.

Por eso el punto viaja marcado: RILes ya tiene el concepto `estimado: true` de
la fase 1, y esto entra por ahí.

---

## 6. Lo que la pantalla tiene que decir

Requisito explícito, no una sugerencia de diseño: **en la web tiene que quedar
dicho que el volumen es estimado, en el mismo lugar donde se muestra el
número.**

No alcanza con guardar `estimado: true` en el dato. Un volumen integrado desde
un caudal se ve idéntico a uno leído de un totalizador, y quien mire la pantalla
dentro de seis meses —o un fiscalizador— no tiene cómo distinguirlos si la
interfaz no lo dice.

Dónde y qué:

| Dónde                              | Qué tiene que decir                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Cada período con volumen integrado | Marca visible de estimado, no sólo un tooltip                                                          |
| La pestaña Balance                 | Que la salida proviene de un caudal integrado y no de un totalizador, con el dispositivo que lo genera |
| El detalle del período             | Método, dispositivo (Palmer-Bowlus 4"), y cuántas muestras entraron a la integral                      |
| Cualquier período incompleto       | Que hubo huecos de comunicación y que el volumen cubre menos tiempo del que dice el período            |
| Fuera de rango del dispositivo     | Que el nivel superó el fondo de escala y el número no es confiable                                     |
| El informe mensual descargable     | La misma leyenda, en el documento — es el que sale de la plataforma y circula solo                     |

El texto debe evitar el tecnicismo: el lector es el encargado de la planta, no
quien configuró el mapeo. Algo como _"Volumen estimado a partir del caudal
medido en canal abierto (Palmer-Bowlus 4"). No proviene de un totalizador."_

Y la contracara: un sitio cuyo volumen **sí** viene de totalizador no debe
llevar ninguna leyenda. Si todo lleva advertencia, la advertencia deja de
significar algo.

---

## 7. Dónde encaja: RILes casi no se toca

El balance de RILes lee `site_contador_mensual` y normaliza con
`aM3(delta, unidad)` (`modules/riles/service.ts:70`). Si la integración escribe
ahí en m³, el balance funciona sin cambios.

El único ajuste es de una línea. Hoy:

```ts
config.modo_caudal === 'derivado' ? new Map() : await serieCacheada(sitioId, 'totalizador');
```

El rol está fijo en `'totalizador'`, así que hay que permitirle también
`'volumen_integrado'`. Con eso, un sitio con flume queda en modo `propio` y todo
lo demás —coeficiente de descarga, estados, la pestaña Balance— sigue igual.

---

## 8. Plan

| Fase | Qué                                                                    | Depende de       |
| ---- | ---------------------------------------------------------------------- | ---------------- |
| 0    | Arreglar la escala del nivel de S151 (ver §9) — no requiere desarrollo | Rango del sensor |
| 1    | Transformación `caudal_potencia` + parámetros en el editor de mapeos   | Fase 0           |
| 2    | Integración a volumen, worker y escritura en `site_contador_*`         | Fase 1           |
| 3    | Que RILes acepte el rol `volumen_integrado`, y las leyendas de §6      | Fase 2           |

La fase 1 sirve sola: con sólo eso, el caudal ya se ve en el dashboard y se
puede alarmar sobre él, aunque todavía no haya volumen.

---

## 9. El estado real de S151 al 22-09-2026

Verificado en producción, no supuesto.

**El sitio existe y su fuente ya está declarada.** `S151` "Riles 1"
(`25.24.39.7`, E113/SE118), con una fila en `riles_fuente`: entrada desde `S142`
rol totalizador, factor 1, vigente desde el 01-09-2026. Pero `riles_config`
está **vacía** — el sitio todavía no tiene `modo_caudal` ni coeficientes.

**El nivel NO llega en metros.** El mapeo `RM7A6CA918` declara `unidad: m`,
`transformacion: lineal`, `factor: 1, offset: 0`. Lo que llega en `AI12` son
valores entre **3.380 y 20.490**. Con ese mapeo, la plataforma está reportando
un nivel de ~7.000 metros.

El rango delata la señal: es un **4-20 mA expresado en microamperios**. El máximo
de 20.490 µA es 20 mA con el sobrerrango normal, y el p05-p95 va de 5,82 a
11,84 mA, o sea entre 11% y 49% del span. El mínimo de 3.380 µA cae bajo los
4 mA, que es señal de sensor fuera de rango o desconectado.

Esto **no necesita desarrollo**: la plataforma ya tiene el modo de escala por
rango 4-20 mA sobre `lineal`, con el rango en `parametros`. Falta un solo dato
para configurarlo: **a qué altura de agua corresponden los 4 mA y los 20 mA**
del sensor.

**Y hay un problema de resolución que conviene mirar ahora.** El flume de 4"
topa en 0,0762 m. Si el sensor abarca bastante más que eso, todo el rango útil
queda comprimido en la parte baja de la señal, y el error se amplifica al
elevar a 1,9. Vale la pena confirmar que el sensor esté dimensionado para el
flume y no para un estanque.

**El sitio dejó de transmitir el 14-09-2026.** Sólo hay 662 filas en total,
entre el 03-09 y el 14-09. Nada en los últimos 8 días. Tiene una alerta
configurada, así que esto debería haber avisado; es un tema operativo aparte,
pero bloquea cualquier verificación con datos reales.

---

## 10. Lo que falta saber

1. **¿Cuál es el rango del sensor de nivel?** Qué altura corresponde a 4 mA y
   cuál a 20 mA. Es el único dato que falta para dejar el nivel bien escalado.
2. **¿Dónde se mide el nivel?** La ficha lo especifica: el punto Ha, 2" aguas
   arriba de la garganta. Si el sensor está en otro lado, la curva no es ésta.
3. **¿El caudal esperado cabe en 3,4 L/s?** Es el tope del flume de 4". Si el
   RIL de la planta lo supera, el problema es de terreno y ninguna fórmula lo
   arregla.
4. **¿Hay riesgo de sumergencia?** Depende de la condición aguas abajo. No lo
   podemos detectar; hay que preguntarlo.
5. **¿Por qué dejó de transmitir el 14-09?**

---

## 11. Lo que esta propuesta decide NO hacer

- **No hace una transformación por dispositivo.** Una ley de potencia con C y n
  configurables cubre Palmer-Bowlus, Parshall y vertederos. Un
  `palmer_bowlus_4in` obligaría a un caso nuevo por cada tamaño.
- **No rellena huecos.** Un tramo sin datos no se interpola ni se completa con
  el promedio: se marca.
- **No presenta el resultado como medición.** Va marcado como estimado en todo
  el camino, hasta la pantalla.
- **No habilita la transformación `formula` genérica.** Un evaluador de
  expresiones arbitrarias en el pipeline de datos es otra discusión, con otros
  riesgos.
