# Mantenimiento de slots DGA — recalcular y dar de baja por rango

Panel en la pestaña **DGA** del detalle de pozo, detrás del icono de llave que
está junto al selector de rango de _Detalle de Registros_. Solo lo ven
SuperAdmin y Admin.

## Por qué existe

Hasta septiembre de 2026 la plataforma solo podía actuar sobre slots en
`requires_review`, **de a uno**. Todo lo demás se hacía entrando a la base por
SSH. Los tres huecos, los tres reales:

1. **Dar de baja un `pendiente`.** Un slot que pasó la validación pero cuyo dato
   NO es declarable —un totalizador que retrocede durante una ventana conocida—
   nunca entra a la cola de revisión, así que no había forma de cerrarlo.
2. **Recalcular.** Al corregir un mapeo (una unidad, un factor, un cut-off) el
   valor ya materializado en `dato_dga` queda con la config vieja y **no se
   recalcula solo**.
3. **Actuar sobre un rango.** Con 55 slots, de a uno no es viable.

Los tres salieron del recambio de caudalímetro de S128 — ver
[s128-recambio-caudalimetro-2026-09.md](./s128-recambio-caudalimetro-2026-09.md).

## Endpoints

```
GET  /api/v2/dga/sites/:siteId/slots/resumen?desde&hasta   → conteo por estado
POST /api/v2/dga/sites/:siteId/slots/bulk                  → recalcular | dar_de_baja
```

Los dos exigen **SuperAdmin o Admin**, y el POST además **2FA** (header
`X-2FA-Code`; en el frontend lo orquesta `twoFactorInterceptor` de forma global,
así que el componente no maneja códigos).

El resumen es lectura y existe para que la acción no se aplique a ciegas. Está
restringido a los mismos roles que la acción: el estado interno de la cola de
envío no es dato de tenant.

## Las dos acciones

### `recalcular`

Devuelve los slots a `vacio` para que el worker de fill los recompute con la
configuración actual del `reg_map`.

Es la más segura de las dos: **no destruye nada**. El crudo sigue en `equipo` y
el fill lo rearma. `validation_warnings` se limpia a `'[]'::jsonb` porque
describía los valores viejos.

> `validation_warnings` es `JSONB NOT NULL DEFAULT '[]'`. Asignarle `NULL`
> revienta la constraint y el endpoint devuelve 500. Pasó en producción.

### `dar_de_baja`

Cierra los slots como `fallido`, con la nota del operador dentro del slot
(`validation_warnings`, código `admin_discarded_bulk`) y el motivo tipificado en
`fail_reason` como `baja_<tipo>`.

Motivos disponibles: `recambio_instrumento`, `sin_dato_crudo`,
`dato_no_confiable`, `otro`.

El tipo va en `fail_reason` y no solo en la nota para que sea **consultable**:
"todas las bajas por recambio de instrumento" es una query, no una búsqueda de
texto libre.

## Los candados

Cada uno tiene test en `main-api/src/modules/dga/__tests__/slots-bulk.test.ts`.

| Candado                                                              | Por qué                                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `enviado` y `enviando` **nunca** entran                              | El primero ya salió a SNIA con folio y reescribirlo falsearía una declaración hecha; el segundo tiene un envío en vuelo                        |
| El rango va acotado al sitio en el CTE **y otra vez** en el `UPDATE` | Un `WHERE` de menos se lleva slots de otro pozo                                                                                                |
| Tope `BULK_SLOT_LIMIT = 800` por request                             | Un mes horario son ~744, así que cubre el caso real sin que un cero de más barre un año entero                                                 |
| La nota es obligatoria (mín. 5 caracteres)                           | Queda en el `audit_log` junto con el rango. Un tramo sin explicación es lo que hace imposible reconstruir después por qué un mes no se declaró |

Estados que sí se pueden tocar: `pendiente`, `requires_review`, `fallido`
(`BULK_TOUCHABLE_ESTADOS` en `modules/dga/repo.ts`).

## El flujo es de dos pasos a propósito

Primero **Revisar**, que solo lee y muestra el desglose por estado. Recién con
ese conteo a la vista se habilitan las acciones. Una acción de rango aplicada a
ciegas sobre declaraciones DGA es exactamente lo que no queremos.

El desglose responde la pregunta que uno trae al abrir el panel — _¿qué sale a la
DGA si pongo el pozo en envío?_ — porque el conteo de afectables **no** la
responde. En S128 decía "se van a afectar 14" cuando el único enviable era 1: los
otros 13 eran 11 `fallido` y 2 `requires_review`, que el worker de envío no toma.

```
En el rango: 829 slots
  Enviado           — ya declarado · no se toca        815
  Dado de baja      — cerrado, no se envía              11
  Pendiente         — se enviará a la DGA                1
  Requiere revisión — retenido, no se envía              2
  ─────────────────────────────────────────────────────────
  Saldrían a la DGA al poner en envío: 1 slot
  La acción afectaría 14 slots, de los cuales 11 ya están dados de baja.
```

Un `fallido` cerrado a mano se muestra como **"Dado de baja"** y no como
"Fallido": un recambio de instrumento es un evento esperado y documentado, no
una falla del sistema. La distinción sale de `fail_reason LIKE 'baja_%'`
(`BAJA_MANUAL_PREFIX`), y el prefijo del `INSERT` y el del `LIKE` están
verificados por test — si se separan, las bajas dejan de reconocerse.

> El estado terminal sigue siendo `fallido`: lo usan el reconciler, las alertas
> y los reportes. Lo de arriba es presentación.

## Zona horaria

Los campos del panel son `datetime-local`, que **no lleva zona**. El rango se
ancla explícitamente en `-04:00` (la convención del proyecto, `CHILE_TIME_ZONE`).

Si se dejara la zona del sistema, en horario de verano chileno (UTC−3) el rango
se correría una hora y se recalcularían slots equivocados **sin ningún error a
la vista**.

El rango es **semiabierto**: incluye `desde`, excluye `hasta`.

## Auditoría

`auditDgaMutations` (en `http/v2/routes.ts`) registra la acción como
`dga.slots.recalcular` o `dga.slots.dar_de_baja`, con
`targetId = <siteId>::<desde>..<hasta>`. La nota del operador viaja en el body y
queda en el `audit_log`.

Para la baja, además, la nota y el autor quedan **dentro de cada slot**:

```sql
SELECT ts, estatus, fail_reason,
       validation_warnings->-1->>'code'   AS ultimo_warning,
       validation_warnings->-1->>'motivo' AS motivo,
       validation_warnings->-1->>'by'     AS por
  FROM dato_dga
 WHERE site_id = 'S128' AND estatus = 'fallido';
```

## Después de recalcular

El worker de fill toma **24 slots por ciclo, cada 60 segundos**
(`DGA_WORKER_MAX_SLOTS`, `DGA_WORKER_POLL_MS`), así que un rango de 55 slots
tarda ~3 minutos en repoblarse. El panel lo dice en el resultado.

El worker de envío despacha hasta **50 por ciclo cada 5 minutos**
(`DGA_SUBMISSION_MAX_PER_CYCLE`, `DGA_SUBMISSION_POLL_MS`), con 1 s de throttle
entre envíos.
