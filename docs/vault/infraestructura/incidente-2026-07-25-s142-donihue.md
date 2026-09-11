# Incidente: S142 (Doñihue) sin transmisión — 25 al 30 de julio 2026

**Estado:** ✅ Transmisión restablecida el 30/07/2026 15:51 (hora Chile).
⚠️ Pendiente: decidir si los 4 días no declarados se justifican ante la DGA.

**Sitio:** `S142` — "Pozo", empresa `E113`, `id_serial` `151.21.49.121`
**Obra DGA:** `OB-1306-883` · `dga_transport='rest'` · `dga_periodicidad='dia'`
**Detectado:** en revisión retrospectiva el 27/08/2026 (no hubo alerta en su momento)

---

## Ventanas de no transmisión

Hora Chile (UTC-4). "Última lectura" y "primera lectura" son timestamps reales
de la tabla `equipo`; el hueco es el intervalo entre ambas.

| #     | Última lectura  | Primera lectura | Duración         |
| ----- | --------------- | --------------- | ---------------- |
| 1     | sáb 25/07 17:08 | lun 27/07 10:52 | 41 h 44 min      |
| 2     | lun 27/07 19:31 | mié 29/07 12:36 | 41 h 06 min      |
| 3     | mié 29/07 20:04 | jue 30/07 13:18 | 17 h 14 min      |
| 4     | jue 30/07 15:34 | jue 30/07 15:51 | 18 min           |
| **Σ** |                 |                 | **100 h 22 min** |

Sobre un episodio total de 118 h 43 min (25/07 17:08 → 30/07 15:51), el equipo
estuvo sin transmitir el **84,5 % del tiempo**.

### Ventanas en que sí transmitió

| Día                   | Ventana       | Lecturas |
| --------------------- | ------------- | -------- |
| dom 26/07             | —             | **0**    |
| lun 27/07             | 10:52 – 19:31 | 520      |
| mar 28/07             | —             | **0**    |
| mié 29/07             | 12:36 – 20:04 | 449      |
| jue 30/07             | 13:18 – 24:00 | 626      |
| vie 31/07 en adelante | completo      | 1440/día |

---

## Cronología

| Fecha/hora (Chile) | Evento                                                               |
| ------------------ | -------------------------------------------------------------------- |
| sáb 25/07 17:08    | Última lectura antes del episodio. Ese día venía completo (1029).    |
| dom 26/07          | Cero lecturas en todo el día. Slot DGA del 26 queda sin dato.        |
| lun 27/07 10:52    | Vuelve a transmitir. Sube en diferido lo muestreado (atraso 1d 17h). |
| lun 27/07 12:00    | Slot DGA diario cae dentro de la ventana con dato → **se declara**.  |
| lun 27/07 19:31    | Cae de nuevo.                                                        |
| mar 28/07          | Cero lecturas en todo el día.                                        |
| mié 29/07 12:36    | Vuelve. El slot DGA de las 12:00 ya había pasado → sin dato.         |
| mié 29/07 20:04    | Cae.                                                                 |
| jue 30/07 13:18    | Vuelve. El slot DGA de las 12:00 ya había pasado → sin dato.         |
| jue 30/07 15:34    | Micro-corte de 18 min.                                               |
| jue 30/07 15:51    | **Restablecimiento definitivo.**                                     |
| vie 31/07          | Primer día completo (1440/1440) y declaración enviada.               |

---

## Causa raíz

**No determinada desde la telemetría.** Lo que sí acota la evidencia:

1. **No fue la plataforma.** La VM, la BD y los workers operaron normal en esas
   fechas; el resto de los sitios no muestra huecos equivalentes. El incidente
   de VM caída fue el 2026-07-10, quince días antes
   ([[incidente-2026-07-10-vm-caida]]), y a S142 no le faltan datos ese día.

2. **No fue pérdida en la subida.** El 27/07 el `received_at - time` llega a
   1 d 17 h: el equipo muestreó local y subió cuando volvió el enlace. O sea el
   buffer del csvprocessor aguanta días. Por lo tanto los días con **cero filas**
   (26 y 28/07) son datos que nunca se generaron, no datos perdidos en tránsito.

3. **El patrón es diurno y de día hábil.** Cae al atardecer (17:08 / 19:31 /
   20:04), vuelve a media mañana o mediodía (10:52 / 12:36 / 13:18), y está
   completamente muerto el domingo 26 y el martes 28. Una falla de la red
   eléctrica de la comuna no se apaga a las 19:30 y se prende a las 10:52 en
   días hábiles alternos. Esto apunta a **alimentación intermitente en el sitio**
   — trabajo en el tablero, grupo electrógeno, o alguien energizando el punto
   durante la jornada — no a un corte de zona.

4. **Queda una ambigüedad real:** `id_serial` de S142 es una IP
   (`151.21.49.121`), así que el equipo se consulta por red. "No se generó dato"
   puede ser tanto equipo sin energía como equipo inalcanzable por red. La tabla
   `equipo` sola no los distingue. **Hay que confirmar con terreno.**

5. **Indicio secundario:** desde fines de julio el reloj del equipo quedó
   adelantado 1-3 min respecto del servidor (`received_at - time` negativo casi
   todos los días desde el 29/07). Antes del 25/07 era positivo y chico. Algo se
   le intervino al equipo en esa ventana. No rompe nada — las muestras siguen
   cayendo en minuto exacto, así que el match de bucket del fill calza igual.

---

## Impacto DGA

Periodicidad **diaria**: 1 declaración por día, no una por hora. De los 5 días
del episodio, **1 se declaró y 4 no**.

| Fecha | Estado del slot | fail_reason          | Enviado a SNIA |
| ----- | --------------- | -------------------- | -------------- |
| 26/07 | `fallido`       | `no_data_definitivo` | No             |
| 27/07 | `enviado`       | —                    | **Sí**         |
| 28/07 | `fallido`       | `no_data_definitivo` | No             |
| 29/07 | `fallido`       | `no_data_definitivo` | No             |
| 30/07 | `fallido`       | `no_data_definitivo` | No             |

- **`intentos = 0` en los cuatro.** Nunca se intentó postear: no hay rechazos ni
  duplicados en SNIA, esos días simplemente no están declarados.
- **Nada erróneo salió.** El pipeline no rellenó con estimaciones ni arrastró el
  último valor válido; dejó el slot vacío y lo cerró.
- **No son recuperables.** `caudal_instantaneo`, `flujo_acumulado` y
  `nivel_freatico` en NULL, y no existe bucket en `equipo_1min` para esos ts.
- El cierre lo hizo el **check H** del reconciler (`markSlotNoDataDefinitivo`,
  `main-api/src/modules/dga/repo.ts:476`): baja **documentada**, con el motivo
  escrito en `validation_warnings` del propio slot. Ver
  [[../pipeline-dga/dga-workers]] para los checks G y H.
- El **27/07 se salvó por el horario**: el slot diario caía a las 12:00 y esa
  hora quedó dentro de la ventana 10:52-19:31 con dato. El 29 y el 30 el dato
  volvió 12:36 y 13:18 — después del slot. Cuestión de minutos.

---

## Continuidad desde el restablecimiento

- **28 declaraciones diarias consecutivas enviadas**, del 31/07 al 27/08.
- **27 días completos con 1440/1440 lecturas** (31/07 al 26/08).
- Sin ningún hueco > 15 min en los 60 días revisados fuera de las 4 ventanas de
  julio.
- Al 27/08/2026 19:33 UTC el sitio estaba transmitiendo con la última lectura de
  hace 3 minutos.

---

## Acciones

- [ ] **Terreno:** confirmar qué pasó en el sitio entre el 25 y el 30/07
      (tablero, alimentación, enlace). Es lo que cierra la causa raíz y decide
      si la categoría de la incidencia es `electrico` o `comunicacion`.
- [ ] **DGA:** decidir si los 4 días no declarados se justifican ante la DGA.
      Decisión regulatoria, no técnica — el dato no existe y no se puede
      reconstruir.
- [ ] **Registrar la incidencia** en Bitácora del sitio S142 (ver valores abajo).
- [ ] **Alertas:** no hubo aviso automático de las ~100 h sin transmitir; se
      detectó recién en revisión retrospectiva un mes después. Revisar el umbral
      de alerta de sitio sin datos para sitios con DGA activo.
- [ ] **Reloj del equipo:** sincronizar NTP en el Windows de S142.

---

## Valores para la incidencia (Bitácora → S142)

| Campo         | Valor                                                             |
| ------------- | ----------------------------------------------------------------- |
| `titulo`      | S142 sin transmisión 25-30/07/2026 — 4 declaraciones DGA perdidas |
| `origen`      | `remota`                                                          |
| `categoria`   | `electrico` (cambiar a `comunicacion` si terreno lo desmiente)    |
| `gravedad`    | `critica` (dejó días sin declarar en obra OB-1306-883)            |
| `estado`      | `resuelta` (cerrar cuando se resuelva el punto DGA)               |
| `descripcion` | Ventanas y cronología de esta ficha                               |

---

## Cómo detectarlo rápido en el futuro

Los huecos > 15 min de un sitio, sin necesidad de conocer la fecha:

```bash
docker exec -i emeltec-db sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"SELECT prev desde, t hasta, t-prev hueco FROM (SELECT time t, lag(time) OVER (ORDER BY time) prev FROM equipo WHERE id_serial=(SELECT id_serial FROM sitio WHERE id='S142') AND time >= now() - interval '60 days') a WHERE t-prev > interval '15 minutes' ORDER BY 3 DESC LIMIT 30\""
```

Y el impacto DGA día por día:

```bash
docker exec -i emeltec-db sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c \"SELECT fecha, count(*) slots, count(*) FILTER (WHERE estatus='enviado') enviados, count(*) FILTER (WHERE fail_reason='no_data_stale') stale, count(*) FILTER (WHERE estatus='vacio') vacios FROM dato_dga WHERE site_id='S142' AND ts >= now() - interval '60 days' GROUP BY 1 ORDER BY 1\""
```

El runbook completo de las 9 consultas quedó fuera del repo, en el scratchpad de
la sesión del 27/08/2026.

---

## Ver también

- [[incidente-2026-07-10-vm-caida]] — otro episodio de julio, sin relación
- [[../db/dato-dga]] — estados del slot y flujo `vacio → pendiente → enviado`
- [[../db/equipo]] — `time` vs `received_at`, que es lo que distingue falla de
  energía de falla de enlace
