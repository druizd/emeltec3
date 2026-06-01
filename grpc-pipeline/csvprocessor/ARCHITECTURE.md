# csvprocessor - Arquitectura

Servicio Windows en Go que ingesta archivos CSV/log de equipos industriales, genera respaldo raw por `id_serial`, transforma los datos y los envia al `csvconsumer` por gRPC.

---

## Flujo Principal

```text
data/incoming_logs/
  archivo.csv
      |
      v
ExtractSerialIDFromFile
  extrae id_serial desde el tagname
      |
      v
CopyToBackupBySerial
  copia raw a data/raw_backup/<id_serial>/YYYY-WNN/
      |
      v
ReadRows
  parsea CSV con separador "," o ";"
      |
      v
BuildTelemetryRecords
  agrupa filas por id_serial + fecha + hora
  serializa variables en JSON
      |
      v
SendRecords
  envia registros por gRPC al csvconsumer
      |
      +-- OK    -> DeleteFile desde incoming_logs
      +-- ERROR -> retry hasta 3 intentos; luego MoveToFailed
```

Desde 2026-06-01, el procesador tambien guarda cada `TelemetryRecord` en SQLite
local antes del envio gRPC:

```text
CSV/log -> TelemetryRecord -> SQLite telemetry_records pending
                         -> gRPC Linux OK -> SQLite synced
                         -> gRPC falla   -> SQLite queda pending
```

Un loop `LOCAL_SYNC_INTERVAL_SEC` reintenta los registros `pending` desde SQLite
contra el `csvconsumer`.

---

## Formato de Archivo

```text
Tagname;TimeStamp;Value;DataQuality
151.20.35.10--1.AI23;2026-05-15 22:00:00.000;1.5;100
151.20.35.10--1.REG4;2026-05-15 22:00:00.000;0.0;100
```

### Tagname

```text
151.20.35.10--1.AI23
|-------------|  |--|
 id_serial       nombre_dato
```

Reglas:

- `id_serial` es la parte antes de `--`.
- `nombre_dato` es la parte despues del ultimo punto.
- El archivo se respalda bajo `raw_backup/<id_serial>/`.

### Registro gRPC

Varias filas del mismo equipo y timestamp se agrupan en un registro:

```json
{
  "id_serial": "151.20.35.10",
  "fecha": "2026-05-15",
  "hora": "22:00:00",
  "data": {
    "AI23": 1.5,
    "REG4": 0
  }
}
```

---

## Workers y Loops

| Loop         |            Intervalo | Funcion                                           |
| ------------ | -------------------: | ------------------------------------------------- |
| File watcher |  `WATCH_INTERVAL_MS` | Escanea `incoming_logs/` y encola archivos nuevos |
| Workers      |        `NUM_WORKERS` | Procesan archivos en paralelo                     |
| Retry        | `RETRY_INTERVAL_SEC` | Re-encola archivos desde `failed_logs/`           |
| Stats        | `STATS_INTERVAL_SEC` | Imprime contadores en terminal                    |
| Archiver     |               1 hora | Comprime backups semanales y mensuales            |

El archiver corre inmediatamente al iniciar el proceso y luego cada 1 hora.

---

## Salida en Terminal

PowerShell debe estar en UTF-8 para mostrar emojis correctamente:

```powershell
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
```

Ejemplo:

```text
🚀 csvprocessor iniciado | 👷 workers: 8 | 👀 watch: 50ms | 🔁 retry: 30s
📦 archiver | revisando backups para comprimir...
✅ archiver | revision completada
✅ log archivo.csv | attempt 1/3 | records: 1 | 7ms
📊 stats | ✅ procesados: 1 | 📥 insertados: 1 | ❌ fallidos: 0 | ♻️ recuperados: 0 | ⏳ pendientes: 0 | 🧯 failed: 0
```

---

## Configuracion `.env`

El ejecutable carga `.env` desde:

```text
<carpeta_del_exe>\csvprocessor\.env
<carpeta_del_exe>\.env
```

En la VM de produccion, el servicio apunta a:

```text
C:\Users\azureuser\Documents\csvprocessor\csvprocessor.exe
```

Por eso el `.env` efectivo debe existir en:

```text
C:\Users\azureuser\Documents\csvprocessor\.env
```

Ejemplo de produccion:

```env
GRPC_ADDRESS=145.190.8.19:50051
TIMEOUT_SECONDS=10

INPUT_DIR=C:\Users\azureuser\Documents\csvprocessor\data\incoming_logs
RAW_BACKUP_DIR=C:\Users\azureuser\Documents\csvprocessor\data\raw_backup
FAILED_DIR=C:\Users\azureuser\Documents\csvprocessor\data\failed_logs
SQLITE_PATH=C:\Users\azureuser\Documents\csvprocessor\data\local\telemetry_local.db
LOCAL_SYNC_INTERVAL_SEC=30

LINUX_DB_API_URL=http://145.190.8.19:3010
PLC_COMMAND_POLL_INTERVAL_SEC=5
PLC_DRY_RUN=true

MAIN_API_URL=
INTERNAL_API_KEY=

NUM_WORKERS=8
WATCH_INTERVAL_MS=50
RETRY_INTERVAL_SEC=30
STATS_INTERVAL_SEC=10
```

Defaults del codigo:

| Variable                        | Default                         | Descripcion                                 |
| ------------------------------- | ------------------------------- | ------------------------------------------- |
| `GRPC_ADDRESS`                  | `localhost:50051`               | Direccion del csvconsumer                   |
| `TIMEOUT_SECONDS`               | `10`                            | Timeout por llamada gRPC                    |
| `INPUT_DIR`                     | `data/incoming_logs`            | Carpeta de entrada                          |
| `RAW_BACKUP_DIR`                | `data/raw_backup`               | Respaldo raw por `id_serial`                |
| `FAILED_DIR`                    | `data/failed_logs`              | Archivos con 3 intentos fallidos            |
| `SQLITE_PATH`                   | `data/local/telemetry_local.db` | Respaldo/cola local SQLite                  |
| `LOCAL_SYNC_INTERVAL_SEC`       | `30`                            | Reintento de telemetria pendiente           |
| `LINUX_DB_API_URL`              | ``                              | API Linux para comandos PLC                 |
| `PLC_COMMAND_POLL_INTERVAL_SEC` | `5`                             | Polling de comandos PLC                     |
| `PLC_DRY_RUN`                   | `true`                          | Simula ejecucion PLC sin escribir al equipo |
| `NUM_WORKERS`                   | `4`                             | Workers paralelos                           |
| `WATCH_INTERVAL_MS`             | `200`                           | Frecuencia de escaneo                       |
| `RETRY_INTERVAL_SEC`            | `60`                            | Frecuencia de retry                         |
| `STATS_INTERVAL_SEC`            | `10`                            | Frecuencia de stats                         |
| `MAIN_API_URL`                  | `http://localhost:3000`         | URL de main-api para alertas                |
| `INTERNAL_API_KEY`              | ``                              | API key interna para alertas                |

---

## Directorios de Datos

```text
C:\Users\azureuser\Documents\csvprocessor\data\
  incoming_logs\              archivos por procesar
  raw_backup\<id_serial>\     respaldo raw del archivo original
  failed_logs\                archivos que fallaron 3 intentos
  local\telemetry_local.db    SQLite local
```

Tablas SQLite:

```text
telemetry_records
  datos leidos del PLC y estado sync_status pending/synced

plc_commands
  comandos descargados desde Linux y resultado de ejecucion local
```

Flujo de comandos PLC:

```text
Linux linux-db-api -> Windows csvprocessor -> PLC -> Windows -> Linux
```

Por defecto `PLC_DRY_RUN=true`; eso valida el circuito completo sin escribir al
PLC real. Para escritura real falta implementar el driver/protocolo del PLC en
`internal/plcagent`. La SQLite local vive en `internal/localdb`.

Estructura del backup:

```text
raw_backup/
  151.20.35.10/
    2026-W21/
      log (...).csv
    2026-W20.zip
    2026-04.zip
```

Reglas del archiver:

- La semana actual queda como carpeta `YYYY-WNN/`.
- Semanas cerradas se comprimen a `YYYY-WNN.zip`.
- ZIPs semanales de meses cerrados se agrupan en `YYYY-MM.zip`.
- Si el ZIP ya existe, elimina la carpeta o ZIP semanal redundante.

---

## Servicio Windows

Consultar ejecutable registrado:

```powershell
Get-CimInstance Win32_Service -Filter "Name='CsvProcessor'" |
  Select-Object Name, PathName
```

Build correcto para la VM:

```powershell
cd "C:\Users\azureuser\Documents\csvprocessor\csvprocessor"
go build -o ..\csvprocessor.exe .\cmd\csvprocessor
Restart-Service CsvProcessor
```

Ver procesos:

```powershell
Get-Process csvprocessor -ErrorAction SilentlyContinue |
  Select-Object Id, Path
```

Debe existir solo:

```text
C:\Users\azureuser\Documents\csvprocessor\csvprocessor.exe
```

Para mirar envios por terminal:

```powershell
Stop-Service CsvProcessor
cd "C:\Users\azureuser\Documents\csvprocessor"
chcp 65001
.\csvprocessor.exe
```

Al terminar:

```powershell
Ctrl+C
Start-Service CsvProcessor
```

No ejecutar consola y servicio al mismo tiempo, porque ambos pueden tomar y borrar los mismos archivos.

---

## Paquetes Internos

| Paquete       | Responsabilidad                                                     |
| ------------- | ------------------------------------------------------------------- |
| `config`      | Lee variables de entorno con defaults                               |
| `filemanager` | Lista, mueve, copia, elimina, extrae `id_serial` y comprime backups |
| `csvreader`   | Parsear CSV con separador `,` o `;`                                 |
| `parser`      | Transformar filas crudas en `TelemetryRecord` agrupados             |
| `sender`      | Enviar registros al csvconsumer via gRPC                            |
| `grpcclient`  | Crear conexion gRPC sin TLS                                         |
| `alertclient` | Enviar alertas HTTP a main-api                                      |

---

## Produccion

- Windows VM: corre `CsvProcessor`.
- Linux VM: corre `csvconsumer` en puerto `50051`.
- Entrada de archivos: `C:\Users\azureuser\Documents\csvprocessor\data\incoming_logs`.
- Alertas HTTP dependen de `MAIN_API_URL`; si queda vacio, el codigo usa el default `http://localhost:3000`.
