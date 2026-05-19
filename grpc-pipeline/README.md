# gRPC Telemetry Pipeline

Pipeline de ingestion de logs industriales basado en Go, gRPC y PostgreSQL/TimescaleDB. El `csvprocessor` corre en Windows como servicio, procesa archivos CSV/log, respalda el raw por equipo y envia registros normalizados al `csvconsumer`.

---

## Componentes

| Componente         | Funcion                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `csvprocessor`     | Lee archivos desde `incoming_logs`, respalda raw, transforma y envia por gRPC |
| `csvconsumer-rust` | Recibe lotes gRPC e inserta en PostgreSQL/TimescaleDB                         |
| `proto`            | Contratos protobuf del pipeline                                               |
| `db-infra`         | Infraestructura local de base de datos                                        |
| `data`             | Carpetas operativas de entrada, backup y fallos                               |

---

## Flujo

```text
Equipo / SFTP / proceso externo
        |
        v
data/incoming_logs/
        |
        v
csvprocessor (Windows)
  - extrae id_serial
  - copia raw a raw_backup/<id_serial>/YYYY-WNN/
  - transforma CSV en TelemetryRecord
  - envia por gRPC
  - elimina archivo procesado
        |
        v
csvconsumer-rust (Linux)
        |
        v
PostgreSQL / TimescaleDB
```

Si un archivo falla 3 veces, se mueve a `data/failed_logs/` y el loop de retry lo vuelve a intentar segun `RETRY_INTERVAL_SEC`.

---

## Estructura

```text
grpc-pipeline/
  csvprocessor/
    cmd/csvprocessor/
    internal/
  csvconsumer-rust/
  proto/
  db-infra/
  go.mod
  README.md
```

En produccion Windows, el layout usado es:

```text
C:\Users\azureuser\Documents\csvprocessor\
  .env
  csvprocessor.exe
  data\
    incoming_logs\
    raw_backup\
    failed_logs\
  csvprocessor\
    cmd\
    internal\
    go.mod
```

El servicio `CsvProcessor` apunta a:

```text
C:\Users\azureuser\Documents\csvprocessor\csvprocessor.exe
```

---

## Configuracion del csvprocessor

Ejemplo `.env` de produccion:

```env
GRPC_ADDRESS=145.190.8.19:50051
TIMEOUT_SECONDS=10

INPUT_DIR=C:\Users\azureuser\Documents\csvprocessor\data\incoming_logs
RAW_BACKUP_DIR=C:\Users\azureuser\Documents\csvprocessor\data\raw_backup
FAILED_DIR=C:\Users\azureuser\Documents\csvprocessor\data\failed_logs

MAIN_API_URL=
INTERNAL_API_KEY=

NUM_WORKERS=8
WATCH_INTERVAL_MS=50
RETRY_INTERVAL_SEC=30
STATS_INTERVAL_SEC=10
```

El ejecutable carga `.env` desde la carpeta del binario. En la VM debe existir:

```text
C:\Users\azureuser\Documents\csvprocessor\.env
```

---

## Build y Servicio Windows

Compilar en la VM al binario que usa el servicio:

```powershell
cd "C:\Users\azureuser\Documents\csvprocessor\csvprocessor"
go build -o ..\csvprocessor.exe .\cmd\csvprocessor
Restart-Service CsvProcessor
```

Validar:

```powershell
Get-Service CsvProcessor
Get-Process csvprocessor -ErrorAction SilentlyContinue | Select-Object Id, Path
```

Debe aparecer solo:

```text
C:\Users\azureuser\Documents\csvprocessor\csvprocessor.exe
```

---

## Ver Envios en Terminal

No correr servicio y consola al mismo tiempo. Para observar los envios:

```powershell
Stop-Service CsvProcessor
cd "C:\Users\azureuser\Documents\csvprocessor"
chcp 65001
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
.\csvprocessor.exe
```

Salida esperada:

```text
🚀 csvprocessor iniciado | 👷 workers: 8 | 👀 watch: 50ms | 🔁 retry: 30s
📦 archiver | revisando backups para comprimir...
✅ archiver | revision completada
✅ log archivo.csv | attempt 1/3 | records: 1 | 7ms
📊 stats | ✅ procesados: 1 | 📥 insertados: 1 | ❌ fallidos: 0 | ♻️ recuperados: 0 | ⏳ pendientes: 0 | 🧯 failed: 0
```

Al terminar:

```powershell
Ctrl+C
Start-Service CsvProcessor
Get-Service CsvProcessor
```

---

## Backup y Archiver

Cada archivo procesado se copia antes de enviarse:

```text
data/raw_backup/<id_serial>/YYYY-WNN/<archivo_original>
```

El archiver:

- Corre al arrancar y luego cada 1 hora.
- Comprime semanas cerradas como `YYYY-WNN.zip`.
- Agrupa ZIPs semanales de meses cerrados como `YYYY-MM.zip`.
- Mantiene la semana actual abierta como carpeta.

Ver ZIPs:

```powershell
Get-ChildItem "C:\Users\azureuser\Documents\csvprocessor\data\raw_backup" -Recurse -Filter *.zip
```

---

## Desarrollo Local

Desde `grpc-pipeline/`:

```powershell
go test ./csvprocessor/...
go build ./csvprocessor/cmd/csvprocessor
```

Para ejecutar manualmente con `.env` local, ubicar el `.env` junto al binario que se va a ejecutar o usar rutas absolutas.

---

## Notas Operativas

- `incoming_logs` puede verse vacio aunque lleguen archivos, porque el procesador los borra despues de enviarlos correctamente.
- `fallidos` en stats es un contador en memoria de la ejecucion actual.
- Si aparecen errores `The system cannot find the file specified`, revisar que no existan dos procesos `csvprocessor` leyendo la misma carpeta.
- Si los emojis se ven corruptos, configurar PowerShell en UTF-8 antes de ejecutar el binario.
