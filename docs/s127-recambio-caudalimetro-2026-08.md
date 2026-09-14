# S127 · Pozo 2 Agrosuper — recambio de caudalímetro, agosto-septiembre 2026

Expediente del caso. Complementa
[s128-recambio-caudalimetro-2026-09.md](./s128-recambio-caudalimetro-2026-09.md):
son el mismo modelo de instrumento y la misma cuadrilla, pero **la configuración
de cada uno es distinta y los errores fueron opuestos**.

|                       |                                                             |
| --------------------- | ----------------------------------------------------------- |
| **Sitio**             | `S127` · Pozo 2 · Faenadora San Vicente (Agrosuper, `E113`) |
| **Obra DGA**          | `OB-0601-389`                                               |
| **Serial**            | `151.21.36.25`                                              |
| **Instrumento nuevo** | SITRANS FMT020                                              |
| **Periodicidad DGA**  | Horaria, transporte REST                                    |
| **Derecho**           | **60 L/s** (cargado el 14-09-2026)                          |

## Línea de tiempo

Horas en UTC; entre paréntesis, hora Chile (UTC−4).

| Momento            | Qué pasó                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 30-08 10:19–12:20  | **Recambio de caudalímetro.** Tres mapeos eliminados, tres creados. Sin ficha de mantenimiento en la plataforma: el único rastro es Trazabilidad |
| 30-08 ~14:00       | Re-base del totalizador: 931.162 → 109.921 m³. SNIA lo aceptó                                                                                    |
| 30-08 14:33–15:37  | `REG2002` aparece sólo en la puesta en marcha y deja un mapeo huérfano con rol `caudal` duplicado. 69 slots quedan `pendiente` con caudal NULL   |
| 07-09              | Se recupera el histórico borrado con la migración `2026-09-07-s127-recupera-serie-medidor-retirado.sql`                                          |
| **07-09 06:33:45** | **Se le pone `factor: 0.2777…` al caudal.** Empieza a declarar 3,6 veces **bajo**                                                                |
| 14-09 04:12:10     | Se corrige a `factor: 1`                                                                                                                         |
| 14-09              | Verificación independiente, carga del derecho, resolución de los dos `flow_negative`                                                             |

## El factor que sobraba

El 07-09 alguien aplicó al caudal de S127 el mismo `divisor = 3,6` que S128 sí
necesitaba. **Acá no correspondía**, y como el pozo está en `rest`, declaró
durante una semana:

| Antes del cambio | Después         |
| ---------------- | --------------- |
| 52,8 – 53,5 L/s  | 13,1 – 14,8 L/s |

`14,7 × 3,6 = 52,9` — la huella del factor es exacta.

**164 slots declarados 3,6× bajo**, del `07-09 07:00Z` al `14-09 04:00Z`. Ya
tienen folio y ninguna vía de la plataforma los toca: es rectificación ante la
DGA por fuera del sistema.

Dos atenuantes para esa conversación:

- **El totalizador nunca se tocó** (`RM68727CC9`, `factor: 1` desde el 30-08),
  así que el **volumen acumulado declarado está correcto** en todo el período.
  Lo mal reportado es sólo el caudal instantáneo.
- El caudal real de 52,9 L/s está **dentro** del derecho de 60, o sea la
  subdeclaración no ocultaba un exceso.

### Cómo se verificó la unidad, sin caer en el error circular

Decodificar el float y compararlo contra lo declarado **no prueba la unidad**:
confirma que la plataforma decodifica bien, nada más. La prueba independiente es
el **techo de los deltas horarios del totalizador**:

```
Avance máximo en 72 horas:  189 m³/h
189 m³/h ÷ 3,6           =  52,5 L/s
Caudal máximo declarado   =  52,542 L/s   ✓
```

Si el medidor entregara m³/h, el caudal real sería 14,6 L/s = 52,5 m³/h, y una
hora de 189 m³ sería físicamente imposible. **`factor: 1` confirmado.**

> **S127 y S128 son casos opuestos con el mismo número.** En S127 el `0.2778`
> era el error; en S128 es la corrección. Aplicar por analogía lo que se aprendió
> en un pozo al otro es exactamente lo que produjo los dos incidentes de
> septiembre — uno en cada dirección. **No hay un factor "de la marca": hay que
> medir cada registro contra el otro en el mismo equipo.**

## El histórico que el recambio borró

Borrar el mapeo viejo en vez de degradarlo dejó **invisible** todo el caudal y
el totalizador anteriores al 30-08: `site_contador_mensual.variable_id` es
`REFERENCES reg_map(id) ON DELETE CASCADE`, y el histórico HTTP arma sus columnas
desde `reg_map`. Flujo Mensual mostraba 2.717 m³ en agosto cuando el real eran
47.140.

Recuperado con la migración del 07-09, que recrea el par `REG372`+`REG373` como
`RM372A0830` con **`rol_dashboard = 'generico'`** y siembra jun/jul/ago 2026 en
`site_contador_mensual` con `rol = 'totalizador'`. Contrastado contra `dato_dga`,
que es fuente independiente ya declarada a SNIA:

| mes    | gráfico  | `dato_dga` | dif       |
| ------ | -------- | ---------- | --------- |
| jun-26 | 40.800,7 | 42.500,0   | **−4,0%** |
| jul-26 | 44.965,9 | 44.919,0   | +0,10%    |
| ago-26 | 47.156,0 | 47.007,0   | +0,32%    |

Junio queda bajo **a propósito**: le faltan los 1.791 m³ entre el 01-06 00:00 y
la primera muestra del crudo (02-06 18:58), más ~250 m³ porque el propio
`dato_dga` de junio arranca a las 04:00. Es un mes parcial conocido, no un error.

**El rol tiene que ser `generico` y el alias no puede decir "totalizador":** el
resolver da 110 puntos a un totalizador `uint32_registros` y 90 a uno
`ieee754_32`, así que el mapeo retirado le ganaría al medidor vivo. Y con rol
`generico` la clave se deriva del alias, de modo que un alias "Totalizador"
vuelve a puntuar igual. Quedó como `REG372 (retirado 30-08-2026)`.

## El caudal llega en cero la mitad del tiempo

El hallazgo más serio que queda abierto. Sobre 6 horas de crudo:

```
53,3 % de las lecturas traen REG3003 = 0 y REG3004 = 0
```

…mientras el totalizador avanza normalmente. No es la bomba apagándose: son
ceros intercalados minuto a minuto entre valores de 54 L/s.

Como el caudal declarado es la **muestra puntual del minuto del slot**, hay esa
misma probabilidad de declarar 0 en una hora con bombeo. Se ve directo en la
serie:

| hora  | caudal declarado | avance real | equivalente |
| ----- | ---------------- | ----------- | ----------- |
| 05:00 | 52,5             | 104 m³      | 28,9 L/s    |
| 04:00 | 14,6             | 153 m³      | 42,5 L/s    |
| 03:00 | **0**            | 99 m³       | 27,5 L/s    |
| 02:00 | **0**            | 45 m³       | 12,5 L/s    |
| 00:00 | **0**            | 39 m³       | 10,8 L/s    |
| 23:00 | **0**            | 19 m³       | 5,3 L/s     |

**El totalizador no tiene el problema**, así que el volumen declarado es
correcto y sólo el caudal instantáneo está sucio.

Comparación de la flota, mismas 6 horas:

| pozo     | lecturas de caudal en cero | registros del caudal |
| -------- | -------------------------- | -------------------- |
| S127     | **53,3 %**                 | `REG3003`+`REG3004`  |
| **S128** | **0,0 %**                  | `REG3000`+`REG3001`  |
| S129     | 66,7 %                     | `REG3002`+`REG3003`  |
| S130     | 66,0 %                     | `REG3002`+`REG3003`  |

Una hipótesis de que fallara "lo que va segundo en la secuencia de lectura"
quedó descartada: en S128 el segundo par también lee limpio. Lo que distingue a
S128 es que su datalogger trae el **remapeo `REG4000`-`REG4003`** del FMT020
(menú 10448+). **Esa es la configuración a replicar en S127.** Es trabajo de
terreno; no se arregla desde la plataforma.

## El nivel freático está sano

Venía bajo sospecha: el histórico de S127 tiene **1.571 saltos mayores a 5 m**
entre horas consecutivas, contra 95 de S129 y 223 de S130. Sobre 48 horas:

| estado    | slots | promedio | rango       |
| --------- | ----- | -------- | ----------- |
| bombeando | 25    | 16,18 m  | 13,4 – 17,7 |
| detenido  | 22    | 7,14 m   | 5,8 – 9,4   |

**Los rangos no se solapan** — 4 m limpios entre el mínimo bombeando y el máximo
detenido. Los saltos son **abatimiento real de 9 m**, no ruido del sensor: el
pozo cicla mucho y el instrumento lo sigue bien.

## Los dos `flow_negative`

Transientes en la transición detenido → bombeando, distintos del reflujo
sostenido de S128. Los dos se aceptaron con **caudal 0**, pero por razones que
conviene distinguir:

**09-09 10:00 — pozo detenido.**

```
09:00  caudal 0       acum 124.552   avance +45   nivel 7,3
10:00  caudal −3,835  acum 124.552   avance   0   nivel 6,9  ← retenido
11:00  caudal 14,805  acum 124.600   avance +48   nivel 15,5
```

Avance 0 y nivel dentro del rango de reposo. Sin extracción esa hora.

**13-09 17:00 — sí hubo extracción.**

```
16:00  caudal 0       acum 131.262   avance +41   nivel 7,6
17:00  caudal −2,011  acum 131.298   avance +36   nivel 9,4  ← retenido
18:00  caudal 15,066  acum 131.345   avance +47   nivel 14,4
```

El totalizador avanzó **36 m³**. Igual va con caudal 0, por dos razones: el
volumen ya está capturado por el totalizador, y es **consistente con lo que el
pozo ya declara** — el slot vecino de las 16:00 salió `enviado` con caudal 0 y
41 m³ de avance. Poner el equivalente del avance (10 L/s) sería inventar un dato
que el instrumento no entregó y romper la coherencia con los ~150 slots vecinos
en la misma situación.

En la nota del segundo quedó constancia del avance, para que no se lea como una
hora sin extracción sino como una hora sin lectura válida de caudal.

## Estado al 14-09-2026

| Verificación            | Estado                                                      |
| ----------------------- | ----------------------------------------------------------- |
| Caudal — escala         | ✅ `factor: 1` confirmado por el techo de deltas (189 m³/h) |
| Caudal — **integridad** | ❌ **53 % de lecturas en cero** — terreno                   |
| Totalizador             | ✅ `0x48011F5B` = 132.221,4 m³, avanza limpio               |
| Nivel freático          | ✅ abatimiento real de 9 m, rangos separados                |
| Mapeos retirados        | ✅ `generico` y sin tokens que puntúen                      |
| Derecho                 | ✅ 60 L/s cargado; 0 slots sobre el límite de 72            |
| Slots retenidos         | ✅ ninguno (316 enviados en septiembre)                     |

## Pendientes

### De terreno

- **Replicar la configuración del datalogger de S128** (remapeo `REG4000`) para
  que el caudal deje de llegar en cero la mitad del tiempo.

### Ante la DGA

- **Rectificar los 164 slots** del `07-09 07:00Z` al `14-09 04:00Z`, declarados
  con el caudal 3,6× bajo. El volumen acumulado de ese período está correcto.

### De plataforma

- **El divisor de la UI no sobrevive al round-trip**: se pliega a `factor` al
  guardar y al recargar la pantalla vuelve a mostrar 1. Es la causa mecánica de
  los dos incidentes de factor de septiembre. Mientras no se arregle, la huella
  va en el alias.
- **El caudal declarado es una muestra puntual** y en un pozo que bombea
  intermitente no representa el caudal medio de la hora. Es correcto según el
  manual DGA, pero hay que tenerlo presente al interpretar las declaraciones y
  al cruzar caudal contra totalizador.
