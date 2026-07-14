# DGA → GCS Exporter

Exporta registros DGA enviados exitosamente a Google Cloud Storage en formato Parquet.

---

## Qué hace

Cada 60 minutos (configurable), el worker:

1. Consulta la DB y trae todos los registros de `dga_send_audit` con `dga_status_code = '00'` en la ventana de tiempo anterior
2. Filtra por empresa (`DGA_GCS_EMPRESA_ID`, default `E101` = CCU)
3. Agrupa los registros por `site_id`
4. Por cada sitio genera un archivo Parquet con tres filas por medición (CAUDAL, TOTALIZADOR, NIVEL_FREATICO)
5. Sube el archivo a GCS con path `{planta}/fecha_carga={YYYY-MM-DD}/{site_id}_{timestamp}.parquet`

---

## Archivos

| Archivo | Rol |
|---|---|
| `main-api/src/modules/dga/gcs-repo.ts` | Query a la DB — trae envíos DGA OK con JOIN a sitio, sub_empresa y pozo_config |
| `main-api/src/modules/dga/gcs-exporter.ts` | Worker principal — cron, build Parquet, upload GCS |
| `main-api/src/server.js` | Arranca el worker al iniciar la API |

---

## Schema Parquet

Cada fila = una variable de una medición DGA enviada con éxito.

| Columna | Fuente DB | Notas |
|---|---|---|
| `NOMBRE_PROVEEDOR` | hardcoded | `"EMELTEC"` |
| `PLANTA` | `sub_empresa.nombre` | sanitizado (sin tildes, ñ→n) |
| `NOMBRE_SENSOR` | `site_id` (temporal) | **TODO: reemplazar con nombre real del sensor** |
| `CENTRO_DE_OBRA` | `pozo_config.obra_dga` | Código DGA oficial, ej: `OB-0601-292` |
| `FECHA_MEDICION_SENSOR` | `dga_send_audit.ts` | ISO 8601 |
| `VARIABLE` | calculado | `CAUDAL` / `TOTALIZADOR` / `NIVEL_FREATICO` |
| `VALOR` | `dato_dga.caudal_instantaneo` etc | string, puede ser null |
| `FECHA_REPORTE_DGA` | `dga_send_audit.sent_at` | ISO 8601 |
| `STATUS_DGA` | `dga_send_audit.dga_status_code` | `"00"` = exitoso |
| `COMPROBANTE` | `dga_send_audit.api_n_comprobante` | número comprobante DGA |
| `MENSAJE_DGA` | `dga_send_audit.dga_message` | sanitizado |
| `FECHA_HORA_CARGA` | timestamp al momento de correr el ciclo | ISO 8601 |

---

## Path en GCS

```
{bucket}/{planta}/fecha_carga={YYYY-MM-DD}/{site_id}_{yyyymmddhhmiss}.parquet
```

Ejemplo:
```
raw-reg-ind-tc-ext-emeltec-prod/ccu_aguas_andinas/fecha_carga=2026-06-24/S042_20260624120000.parquet
```

---

## Variables de entorno

Configurar en `.env` del servidor Linux **antes del deploy**:

```env
# ID de empresa a exportar (CCU = E101)
DGA_GCS_EMPRESA_ID=E101

# Bucket GCS destino
DGA_GCS_BUCKET=raw-reg-ind-tc-ext-emeltec-prod

# Ventana de tiempo en minutos (también define el intervalo del cron)
DGA_GCS_BATCH_MINUTES=60

# Path al service account JSON de GCS
GOOGLE_APPLICATION_CREDENTIALS=/ruta/al/service-account.json

# Deshabilitar el worker sin borrar el código (opcional)
ENABLE_DGA_GCS_WORKER=true
```

---

## Cómo arranca

`server.js` importa `startDgaGcsExporter` desde `gcs-exporter.ts` al iniciar. El worker:

- Corre un ciclo inmediatamente al arrancar
- Luego repite cada `BATCH_MINUTES` minutos con `setInterval`
- Si `EMPRESA_ID` está vacío, loguea warning y omite el ciclo
- Si `ENABLE_DGA_GCS_WORKER=false`, no arranca

---

## Query DB (gcs-repo.ts)

```sql
SELECT
  a.id               AS audit_id,
  a.site_id,
  a.ts               AS fecha_medicion_ts,
  a.sent_at          AS fecha_reporte_dga,
  a.dga_status_code  AS status_dga,
  a.api_n_comprobante AS comprobante,
  a.dga_message      AS mensaje_dga,
  d.caudal_instantaneo,
  d.flujo_acumulado,
  d.nivel_freatico,
  s.descripcion      AS site_descripcion,
  se.nombre          AS sub_empresa_nombre,
  d.obra,
  pc.obra_dga        AS centro_de_obra
FROM dga_send_audit a
JOIN sitio s        ON s.id = a.site_id
JOIN sub_empresa se  ON se.id = s.sub_empresa_id
JOIN pozo_config pc  ON pc.sitio_id = a.site_id
LEFT JOIN dato_dga d ON d.site_id = a.site_id AND d.ts = a.ts
WHERE a.dga_status_code = '00'
  AND a.sent_at >= $1
  AND a.sent_at < $2
  AND s.empresa_id = $3
ORDER BY a.site_id, a.sent_at
```

Tablas involucradas:
- `dga_send_audit` — historial de envíos a la API DGA
- `dato_dga` — valores medidos (caudal, flujo, nivel)
- `sitio` — descripción del punto de medición
- `sub_empresa` — nombre de la planta/empresa cliente
- `pozo_config` — código oficial DGA del pozo (`obra_dga`)

---

## Pendiente antes del deploy

- [ ] Conseguir service account JSON de GCS del cliente CCU
- [ ] Confirmar cuál es el nombre real del sensor (reemplazar `site_id` en `NOMBRE_SENSOR`)
- [ ] Setear variables de entorno en `.env` del servidor Linux
- [ ] Build + `docker restart emeltec-api`
- [ ] Borrar `main-api/gen-parquet-sample.cjs` (script de prueba local, no va a producción)
