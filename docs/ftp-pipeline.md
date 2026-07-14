# FTP Pipeline — Emeltec Cloud

## Arquitectura general

```
Dispositivos FTP
      │
      ▼
Windows Server (Azure)
  ftpprocessor (Go)
  C:\Users\azureuser\Documents\serverwin\ftpprocessor\bin\
      │ gRPC :50061
      ▼
Linux Server (Azure) 145.190.8.19
  ftpconsumer (Docker: emeltec-ftpconsumer)
      │
      ▼
TimescaleDB (Docker: emeltec-db)
  DB: telemetry_platform
```

---

## Dispositivos

| Nombre   | id_serial  | site_id DGA |
|----------|------------|-------------|
| REGADIO  | 25120112   | S131        |
| CASINO   | 25120225   | —           |

### DEVICE_ALIASES en ftpprocessor `.env`
```
DEVICE_ALIASES=REGADIO:25120112,CASINO:25120225
```

---

## Windows Server — ftpprocessor

**Ruta:** `C:\Users\azureuser\Documents\serverwin\ftpprocessor\bin\`

**Directorios clave:**
| Variable | Ruta |
|---|---|
| `INPUT_DIR` | `data\incoming_ftp` |
| `RAW_BACKUP_DIR` | `data\raw_backup\{id_serial}\{year}-W{week}\` |
| `FAILED_DIR` | `data\failed_ftp` |

**Comportamiento:**
- Watcher cada 500ms sobre `incoming_ftp`
- Espera `FILE_READY_AGE_MS=3000` antes de procesar
- Timeout gRPC: 20 segundos
- Filtra: sentinel `-999`, `-999.0`, `FREESPACE` (no filtra quality B)
- Agrupa por `(fecha, hora)` → 1 record por timestamp con JSON de sensores
- Backup por serial + semana ISO: `raw_backup/25120112/2026-W18/archivo.csv`

**Nombre de archivo requerido:** debe contener `_log_` para extraer id_serial correcto
```
✓ REGADIO_log_20260501_20260531.csv  → serial = REGADIO → resuelve a 25120112
✗ REGADIO_mayo2026.csv               → serial = REGADIO_mayo2026 (no resuelve)
```

---

## Base de datos — TimescaleDB

**Contenedor:** `emeltec-db`
**DB:** `telemetry_platform`

### Tabla raw
```sql
equipo (time, id_serial, data jsonb, received_at)
-- Hypertable con 834 particiones
-- Trigger: previene duplicados exactos
```

### Vistas continuous aggregate
```sql
equipo_1min   -- bucket, id_serial, data, received_at, samples
equipo_5min
equipo_hourly
equipo_daily
```
> Las continuous aggregates no actualizan en tiempo real.
> Consultar `equipo` para datos recién insertados.

### Tabla DGA regulatoria
```sql
dato_dga (obra, ts, caudal_instantaneo, flujo_acumulado, nivel_freatico, estatus, site_id)
-- PK: (site_id, ts)
-- NO la llena el ftpconsumer — proceso separado (linux-db-api)
-- REGADIO (S131) tiene pocas filas, CASINO no tiene site_id configurado
```

---

## Formato CSV del FTP

```
fecha;hora;nombre_sensor;valor;unidad;quality
06-05-2026;11:26:00;Flujo Insta;0,0;l/s;G
06-05-2026;11:26:00;Totalizado;4915200;M3;G
06-05-2026;11:26:00;Nivel Freat;17,3;m;G
```

- Separador: `;`
- Decimal: `,`
- Fecha: `DD-MM-YYYY`
- Quality: `G` = bueno, `B` = malo

### Sensores por equipo
| Equipo | Sensores |
|---|---|
| REGADIO | Flujo Insta, Totalizado, Nivel Freat |
| CASINO | Flujo Insta, Totalizado, Nivel Freat, FREESPACE |

---

## Scripts — Procesamiento local

**Ruta:** `ftp-pipeline/`

### `filter-ftp-month.ps1`
Filtra CSV raw por mes/año y quality G. Opcionalmente requiere todos los sensores por timestamp.

```powershell
# Uso básico — solo quality G, solo mayo 2026
.\filter-ftp-month.ps1 `
  -InputFile "C:\ruta\EQUIPO_log_xxx.csv" `
  -OutputFile "C:\serverwin\EQUIPO_log_20260501_20260531.csv" `
  -Year 2026 -Month 5

# Con filtro estricto — solo timestamps con todos los sensores presentes
.\filter-ftp-month.ps1 `
  -InputFile "C:\ruta\EQUIPO_log_xxx.csv" `
  -OutputFile "C:\serverwin\EQUIPO_log_20260501_20260531.csv" `
  -Year 2026 -Month 5 -RequireAllSensors
```

- Excluye `FREESPACE` del conteo de sensores
- Detecta automáticamente cantidad de sensores esperados

### `split-ftp-csv.ps1`
Genera archivos individuales en formato DGA (por submission regulatoria).
**No usar para cargar datos al ftpprocessor** — ese lee formato raw.

---

## Datos cargados

### REGADIO (25120112)
| Período | Filas en DB | Rango UTC |
|---|---|---|
| Mayo 2026 | 19,336 | 2026-05-06 15:26 → 2026-05-31 23:30 |

```
Archivo cargado: REGADIO_log_20260501_20260531.csv (C:\serverwin)
```

### CASINO (25120225)
| Período | Filas en DB | Rango UTC |
|---|---|---|
| Mayo 2026 | 730 | 2026-05-13 20:00 → 2026-05-31 23:30 |

```
Archivo cargado: CASINO_log_20260501_20260531.csv (C:\serverwin)
Nota: solo timestamps con 3 sensores completos quality G (13-31 mayo)
```

---

## Procedimiento — Carga histórica

1. Filtrar CSV con `filter-ftp-month.ps1 -RequireAllSensors`
2. Nombrar como `EQUIPO_log_YYYYMMDD_YYYYMMDD.csv` (requiere `_log_`)
3. Copiar vía RDP a `C:\Users\azureuser\Documents\serverwin\ftpprocessor\bin\data\incoming_ftp\`
4. Esperar log: `ok ftp (SERIAL) archivo.csv | attempt 1/3 | records: N | Xms`
5. Verificar en Linux:
```bash
docker exec emeltec-db psql -U postgres -d telemetry_platform \
  -c "SELECT COUNT(*), MIN(time), MAX(time) FROM equipo WHERE id_serial = 'SERIAL' AND time >= 'YYYY-MM-01' AND time < 'YYYY-MM-01'::date + interval '1 month';"
```

---

## Pendientes

- [ ] CASINO no tiene `site_id` configurado en `dato_dga` — requiere configurar en `linux-db-api`
- [ ] S131 (REGADIO) tiene pocas filas en `dato_dga` — verificar proceso de transformación
- [ ] Cargar datos octubre 2024 (POZO REGADIO y POZO CASINO en `C:\Users\cidm3\Downloads\datos`)
- [ ] Agregar filtro quality B al parser de ftpprocessor (`parser.go`)

---

## Conexión al servidor Linux

```bash
ssh -i ~/Downloads/key.pem azureuser@145.190.8.19
```

## Contenedores relevantes

| Contenedor | Imagen | Función |
|---|---|---|
| `emeltec-ftpconsumer` | ftpconsumer | Recibe gRPC, inserta en `equipo` |
| `emeltec-db` | timescale/timescaledb:latest-pg16 | TimescaleDB |
| `emeltec-linux-db-api` | linux-db-api | Transforma equipo → dato_dga |
| `emeltec-api` | main-api | API principal |
