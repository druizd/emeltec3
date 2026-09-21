# `equipo_1min`: la pregunta que la compresión no resuelve

**Estado:** abierto. Anotado el 21-09-2026, a partir de las mediciones del PR
#233 (compresión de los caggs).

## La pregunta

¿`equipo_1min` debería existir?

Un continuous aggregate se paga con disco y refresco, y se cobra en filas que
el lector no tiene que leer. La medición dice que acá no está cobrando nada.

## Lo que se midió

Producción, 21-09-2026, TimescaleDB 2.27.0 / PG 16.15. Serial `151.20.35.10`
(S100, Vertiente 3), julio 2026 completo, `EXPLAIN (ANALYZE, BUFFERS)`:

|                 | `equipo_1min` | `equipo` crudo |
| --------------- | ------------- | -------------- |
| filas devueltas | 44.313        | 44.325         |
| tiempo          | 19.719 ms     | 371 ms         |
| buffers tocados | 42.764        | 1.166          |

**44.325 contra 44.313: doce filas de diferencia en un mes.** El bucket de 1
minuto no está agrupando nada porque el datalogger ya reporta ~1 muestra por
minuto. El cagg materializa una copia casi 1:1 de la tabla de la que sale.

Y esa copia cuesta:

|                            | Tamaño                        |
| -------------------------- | ----------------------------- |
| Base completa              | 6.601 MB                      |
| `equipo_1min`              | **3.936 MB — el 60% del total** |
| `equipo` crudo, comprimido | 171 MB                        |

La copia pesa 23 veces más que el original, y encima responde 53 veces más
lento porque le falta el `segmentby` que el original sí tiene.

## Qué arregla el PR #233 y qué no

El PR #233 comprime `equipo_1min` y `equipo_5min` con `segmentby = id_serial`.
Eso ataca las dos patologías medibles —el I/O por fila dispersa y el disco— y
es el arreglo correcto para el síntoma que duele hoy: el worker de contadores
muriendo contra el `statement_timeout`.

Lo que **no** toca es la premisa: que convenga materializar un bucket de 1
minuto sobre datos que ya vienen a 1 minuto.

## Qué habría que averiguar antes de decidir

1. **¿Es universal o es de estos seriales?** La medición es de uno solo. Hay
   que ver la razón `samples` vs filas del crudo por serial: el cagg guarda
   `count(*) AS samples`, así que un `avg(samples)` por serial responde esto
   sin escanear el crudo. Si hay sitios que reportan cada 5 o 10 segundos, ahí
   el bucket sí agrupa y el cagg se justifica para ellos.
2. **Quién lee `equipo_1min` hoy.** Según el encabezado de
   `infra-db/migrations/2026-05-22-equipo-data-caggs.sql`: dashboard history,
   CSV export y sites latest-by-minute. Hay que confirmarlo contra el código,
   no contra el comentario.
3. **Qué pasaría con esos lectores si leyeran el crudo.** El cagg hace
   `last(data, time)` por minuto; el crudo devuelve todas las muestras. Para un
   lector que grafica da igual o mejor, pero para cualquier cosa que **cuente**
   muestras o alimente un cálculo declarado no da igual.

## La advertencia importante

Si alguna vez se decide apuntar un lector del cagg al crudo, ojo con
`computeMonthDeltaForVariable` (`main-api/src/modules/contadores/service.ts`).
Ese camino alimenta los contadores, que alimentan las declaraciones a DGA.
Cambiar de `last(data, time)` por minuto a todas las muestras mete más puntos
al algoritmo de detección de resets y **puede mover números ya declarados**.
No es un cambio de rendimiento: es un cambio de resultado. Exige comparación
mes a mes de los 34 contadores antes de tocarlo.

Por eso el PR #233 eligió comprimir en vez de cambiar la fuente.
