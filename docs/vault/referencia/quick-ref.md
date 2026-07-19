---
aliases: [comandos, commands, cheatsheet]
tags: [vault/reference]
---

# Quick Reference — Comandos críticos

← [[HOME]] | Ver también: [[servicios]] · [[schema]] · [[ftp-dispositivos]] · [[dga-setup]]

---

## Conexión al servidor

> [!tip] SSH Linux
>
> ```bash
> ssh -i ~/Downloads/key.pem azureuser@145.190.8.19
> # Repo en VM: ~/emeltec3
> ```

> [!tip] DB directa (desde VM)
>
> ```bash
> # Consola interactiva
> docker exec emeltec-db psql -U postgres -d telemetry_platform
>
> # Query inline
> docker exec emeltec-db psql -U postgres -d telemetry_platform -c "SELECT ..."
>
> # Equivalente desde directorio ~/emeltec3
> docker compose exec -T timescaledb psql -U postgres -d telemetry_platform -c "SELECT ..."
> ```

---

## Queries SQL frecuentes

### Telemetría raw

```sql
-- Filas por device + rango
SELECT COUNT(*), MIN(time), MAX(time)
FROM equipo
WHERE id_serial = '25120112'           -- REGADIO
  AND time >= '2026-05-01'
  AND time <  '2026-06-01';

-- Últimas lecturas de un device
SELECT time, data
FROM equipo
WHERE id_serial = '25120225'           -- CASINO
ORDER BY time DESC LIMIT 5;

-- Ver keys del JSON data de un device
SELECT DISTINCT jsonb_object_keys(data) AS sensor
FROM equipo
WHERE id_serial = '25120112' LIMIT 100;
```

### Configuración sitios y DGA

```sql
-- Config DGA de todos los pozos
SELECT s.id, s.descripcion, s.id_serial,
       pc.obra_dga, pc.dga_activo, pc.dga_transport,
       pc.dga_periodicidad, pc.dga_fecha_inicio, pc.dga_hora_inicio,
       pc.dga_informante_rut, pc.dga_last_run_at
FROM pozo_config pc
JOIN sitio s ON s.id = pc.sitio_id
ORDER BY s.id;

-- Buscar sitio por id_serial
SELECT id, descripcion, id_serial, tipo_sitio, activo
FROM sitio WHERE id_serial IN ('25120112','25120225');

-- reg_map de un sitio (qué sensores mapea)
SELECT alias, d1, d2, rol_dashboard, parametros
FROM reg_map WHERE sitio_id = 'S131';

-- Informantes DGA
SELECT rut, referencia FROM dga_informante;
```

### dato_dga

```sql
-- Resumen slots por sitio y estado
SELECT site_id, estatus, COUNT(*), MIN(ts), MAX(ts)
FROM dato_dga
GROUP BY site_id, estatus
ORDER BY site_id;

-- Últimos slots de REGADIO
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
```

> Ver estado actual de DGA en [[dga-setup]] · tareas pendientes en [[pendientes]].

---

## Logs en la VM

> [!info] Comandos de logs
>
> ```bash
> cd ~/emeltec3
>
> # Estado containers
> docker compose ps
>
> # Logs en vivo
> docker compose logs -f main-api
> docker compose logs -f ftpconsumer
>
> # Últimos 30 min de DGA
> docker compose logs main-api --since 30m | grep -iE "dga|preseed|fill|submission|reconcil"
>
> # Últimos 30 min ftpconsumer
> docker compose logs ftpconsumer --since 30m
>
> # Health check
> curl -s http://localhost:3000/api/v2/health/live
> ```

---

## ftpprocessor (Windows Server)

> [!info] Carga de datos históricos
>
> ```powershell
> # 1. Filtrar CSV local
> .\filter-ftp-month.ps1 `
>   -InputFile "C:\ruta\EQUIPO_log_original.csv" `
>   -OutputFile "C:\serverwin\EQUIPO_log_20260501_20260531.csv" `
>   -Year 2026 -Month 5 -RequireAllSensors
>
> # 2. Copiar via RDP a:
> # C:\Users\azureuser\Documents\serverwin\ftpprocessor\bin\data\incoming_ftp\
>
> # 3. Esperar log:
> # ok ftp (SERIAL) archivo.csv | attempt 1/3 | records: N | Xms
> ```

> [!warning] Regla del nombre de archivo
> El archivo DEBE tener `_log_` en el nombre o el id_serial se extrae mal.
>
> ```
> ✅ REGADIO_log_20260501_20260531.csv  → serial = 25120112
> ❌ REGADIO_mayo2026.csv              → serial = REGADIO_mayo2026 (no resuelve)
> ```

---

## Deploy

> [!tip] Deploy manual
>
> ```bash
> cd ~/emeltec3
> bash scripts/deploy-production.sh
> ```

> [!tip] Aplicar migración SQL manualmente
>
> ```bash
> docker compose exec -T timescaledb psql -U postgres -d telemetry_platform \
>   < ~/emeltec3/infra-db/migrations/NOMBRE.sql
> ```

---

## Variables de entorno críticas (`~/emeltec3/.env`)

| Variable                        | Función                                         |
| ------------------------------- | ----------------------------------------------- |
| `POSTGRES_USER/DB/PASSWORD`     | Credenciales DB                                 |
| `JWT_SECRET`                    | Firma JWT (compartido main-api + auth-api)      |
| `INTERNAL_API_KEY`              | Service-to-service (linux-db-api)               |
| `DGA_ENCRYPTION_KEY`            | AES-256 para claves informante SNIA             |
| `DGA_RUT_EMPRESA`               | RUT Centro de Control Emeltec                   |
| `ENABLE_DGA_SUBMISSION_WORKER`  | **Default `false`** — no tocar sin autorización |
| `RESEND_API_KEY`                | OTP 2FA por email                               |
| `MONITOR_PRIMARY_EMAIL`         | Destino alertas reconciler                      |
| `DEVICE_ALIASES` (ftpprocessor) | `REGADIO:25120112,CASINO:25120225`              |
