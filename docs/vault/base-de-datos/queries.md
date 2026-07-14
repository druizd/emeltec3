---
aliases: [sql, queries, consultas]
tags: [vault/database]
---

# Queries SQL — Referencia rápida

← [[HOME]] | Ver también: [[schema]] · [[quick-ref]] · [[dga-setup]]

---

## Conexión a la DB

```bash
# Consola interactiva
docker exec emeltec-db psql -U postgres -d telemetry_platform

# Query inline
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "SELECT ..."

# Desde directorio ~/emeltec3
docker compose exec -T timescaledb psql -U postgres -d telemetry_platform -c "SELECT ..."
```

---

## Telemetría — tabla `equipo`

```sql
-- Filas por device en rango de fechas
SELECT COUNT(*), MIN(time), MAX(time)
FROM equipo
WHERE id_serial = '25120112'      -- REGADIO
  AND time >= '2026-05-01'
  AND time <  '2026-06-01';

-- Últimas lecturas de un device
SELECT time, data
FROM equipo
WHERE id_serial = '25120225'      -- CASINO
ORDER BY time DESC LIMIT 5;

-- Keys del JSON data
SELECT DISTINCT jsonb_object_keys(data) AS sensor
FROM equipo
WHERE id_serial = '25120112' LIMIT 100;

-- Valor específico de un sensor
SELECT time, (data->>'Flujo Insta')::numeric AS caudal
FROM equipo
WHERE id_serial = '25120112'
ORDER BY time DESC LIMIT 20;
```

> [!warning] Datos recientes
> `equipo_1min` tiene ~2min de delay. Para datos recientes siempre usar `equipo` directamente.

---

## Configuración sitios y pozos

```sql
-- Sitios con config DGA completa
SELECT s.id, s.descripcion, s.id_serial,
       pc.obra_dga, pc.dga_activo, pc.dga_transport,
       pc.dga_periodicidad, pc.dga_fecha_inicio, pc.dga_hora_inicio,
       pc.dga_informante_rut, pc.dga_last_run_at
FROM pozo_config pc
JOIN sitio s ON s.id = pc.sitio_id
ORDER BY s.id;

-- Buscar sitio por serial
SELECT id, descripcion, id_serial, tipo_sitio, activo
FROM sitio WHERE id_serial IN ('25120112','25120225');

-- reg_map de un sitio
SELECT alias, d1, d2, rol_dashboard, parametros
FROM reg_map WHERE sitio_id = 'S131';

-- Informantes DGA registrados
SELECT rut, referencia FROM dga_informante;
```

---

## dato_dga — slots regulatorios

```sql
-- Resumen por sitio y estado
SELECT site_id, estatus, COUNT(*), MIN(ts), MAX(ts)
FROM dato_dga
GROUP BY site_id, estatus
ORDER BY site_id;

-- Últimos 20 slots de un sitio
SELECT ts, estatus, caudal_instantaneo, flujo_acumulado,
       nivel_freatico, comprobante
FROM dato_dga
WHERE site_id = 'S131'
ORDER BY ts DESC LIMIT 20;

-- Slots con validación fallida
SELECT site_id, ts, fail_reason, validation_warnings
FROM dato_dga
WHERE estatus = 'requires_review'
ORDER BY ts DESC;

-- Audit de envíos SNIA
SELECT site_id, ts, attempt_n, transport,
       http_status, dga_status_code, sent_at, duration_ms
FROM dga_send_audit
WHERE site_id = 'S131'
ORDER BY sent_at DESC LIMIT 10;
```

---

## reg_map — mapeo de sensores

```sql
-- Ver mapeo completo de sensores de un sitio
SELECT alias, d1, d2, rol_dashboard, transformacion, parametros
FROM reg_map
WHERE sitio_id = 'S131'
ORDER BY rol_dashboard;
```

> Ver estructura de tablas completa en [[schema]].
