# DGA — Sensor defectuoso: reportar con incidencia registrada

> Introducido en PR #128 (2026-07-06). Motivado por los totalizadores pegados
> de CCU pozo 11 (S121) a la espera de recambio.

## Problema que resuelve

Cuando un sensor de totalizador falla (lectura congelada, equipo esperando
recambio), la validación del fill worker manda cada slot a `requires_review`
(`sensor_frozen`). En un pozo horario eso significa ~24 aprobaciones manuales
con 2FA al día hasta que se cambia el equipo.

La obligación con DGA (Res. 2170) no se suspende porque un sensor esté malo:
hay que seguir reportando lo que el instrumento mide, y dejar constancia de la
falla.

## Cómo funciona

Marca opt-in por sensor, en `reg_map.parametros` del registro con
`rol_dashboard='totalizador'`:

```json
{
  "sensor_known_defective": true,
  "defect_description": "Totalizador pegado, recambio programado 15-07-2026"
}
```

Con la marca activa:

| Anomalía                     | Sin marca         | Con marca                         |
| ---------------------------- | ----------------- | --------------------------------- |
| `sensor_frozen`              | `requires_review` | **informativa** — slot se envía   |
| `sensor_known_defective`     | —                 | **informativa** — slot se envía   |
| `totalizator_zero`           | `requires_review` | suprimida (cubierta por la marca) |
| `flow_negative`              | `requires_review` | `requires_review` (sin cambio)    |
| `flow_exceeds_water_right`   | `requires_review` | `requires_review` (sin cambio)    |
| `caudal_spike`               | `requires_review` | `requires_review` (sin cambio)    |
| `transform_failed_all_nulls` | `requires_review` | `requires_review` (sin cambio)    |

- El slot transiciona a `pendiente` con la **lectura real del instrumento**
  (no se inventan valores) y el submission worker lo envía normal.
- Las anomalías informativas quedan **persistidas en
  `dato_dga.validation_warnings`** — la incidencia es auditable por slot y
  sobrevive el paso a `enviado`.
- El fill worker loguea `warn` por cada slot enviable con incidencias.

## Consultar incidencias registradas

```sql
SELECT ts AT TIME ZONE 'America/Santiago' AS ts_local,
       estatus, flujo_acumulado,
       jsonb_pretty(validation_warnings) AS incidencias
  FROM dato_dga
 WHERE site_id = 'S121'
   AND validation_warnings <> '[]'::jsonb
 ORDER BY ts DESC;
```

## Runbook

**Al detectar sensor malo (confirmado en terreno):**

1. Configurar el sensor totalizador del sitio con
   `sensor_known_defective: true` + `defect_description` con fecha estimada
   de recambio.
2. Verificar en el próximo ciclo del fill worker (≤1 min) que los slots nuevos
   pasan a `pendiente` con `validation_warnings` poblado.
3. El backlog previo en `requires_review` NO se reprocesa: aceptarlo a mano en
   la cola de revisión (la `admin_note` obligatoria documenta cada slot).

**Al instalar el sensor nuevo:**

1. **QUITAR la marca** (`sensor_known_defective: false` o eliminar la clave).
2. Verificar que el totalizador avanza y que la validación vuelve a régimen
   normal (sin warnings en slots nuevos).

Dejar la marca puesta con el sensor ya reparado anula la protección
`sensor_frozen`/`totalizator_zero` para ese pozo — la marca es temporal por
diseño.

## Código

- `main-api/src/modules/dga/validation.ts` — set
  `INFORMATIVE_CODES_WHEN_DEFECTIVE`; `ok`/`failReason` se calculan solo sobre
  warnings bloqueantes.
- `main-api/src/modules/dga/worker.ts` — slot ok-con-warnings → `pendiente`
  persistiendo warnings.
- `main-api/src/modules/dga/repo.ts` — `transitionSlotToPendiente` acepta
  `validation_warnings` opcional.
- Tests: `main-api/src/modules/dga/__tests__/validation.test.ts`.
