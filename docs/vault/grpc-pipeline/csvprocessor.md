# csvprocessor — Cliente Windows

Servicio Windows que captura telemetría de dispositivos Modbus/IP y la envía a csvconsumer en Linux por gRPC.

**Lenguaje:** Go
**Plataforma:** Windows Server (corre como Windows Service)
**Repo:** `C:\Users\azureuser\Documents\csvprocessor\`

---

## Responsabilidades

1. Leer archivos CSV generados por los dispositivos (PLCs, loggers) de las carpetas de entrada
2. Parsear registros de telemetría
3. Guardar en SQLite local (`telemetry_local.db`) como buffer
4. Enviar por gRPC a csvconsumer en Linux
5. Marcar registros como `synced` en SQLite tras ACK exitoso
6. Archivar archivos enviados en `raw_backup/`

---

## Estructura de datos

### SQLite local — `telemetry_local.db`

Tabla `telemetry_records`:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `local_id` | integer PK autoincrement | |
| `id_serial` | text | ID del dispositivo |
| `fecha` | text | Fecha del registro (`YYYY-MM-DD`) |
| `hora` | text | Hora del registro (`HH:MM:SS`) |
| `data` | text | JSON con valores del sensor |
| `sync_status` | text | `pending` / `synced` / `failed` |
| `synced_at` | text | Timestamp de sincronización exitosa |

### Proto — mensaje gRPC

```proto
message TelemetryRecord {
  string id_serial = 1;
  string fecha = 2;
  string hora = 3;
  string data = 4;      // JSON string
}

message SendRecordsRequest {
  string filename = 1;  // nombre del archivo de origen
  repeated TelemetryRecord records = 2;
}

message SendRecordsResponse {
  bool ok = 1;
}
```

---

## Flujo normal

```
Dispositivo genera CSV en carpeta de entrada
  ↓
csvprocessor lee CSV → parsea registros
  ↓
INSERT INTO telemetry_records (sync_status='pending')
  ↓
gRPC SendRecords → csvconsumer Linux :50051
  ↓
ACK ok = true
  ↓
UPDATE sync_status='synced', synced_at=now()
  ↓
Mueve CSV a raw_backup/
```

---

## Estados de `sync_status`

| Estado | Significado |
|--------|-------------|
| `pending` | Guardado en SQLite, aún no enviado por gRPC |
| `synced` | gRPC devolvió ACK (NO garantiza que esté en PostgreSQL — ver gotcha) |
| `failed` | Varios reintentos fallidos (sin red, etc.) |

> ⚠️ **Gotcha crítico:** `synced` significa que csvconsumer recibió el dato y respondió ACK. NO significa que el dato llegó a PostgreSQL. csvconsumer puede fallar el INSERT después del ACK (ver [[../infraestructura/incidente-2026-07-13-csvconsumer-reconexion]]).

---

## Retry de archivos

`retryFailedFiles()` reintenta archivos del directorio `failed_logs/`.
**No reintenta registros SQLite con `sync_status='pending'`** — solo archivos físicos.

La variable de entorno `LOCAL_SYNC_INTERVAL_SEC=30` está definida pero **no está implementada en el código**. No tiene efecto.

---

## Carpetas relevantes

```
C:\Users\azureuser\Documents\csvprocessor\
  csvprocessor/               — código fuente Go
    cmd/csvprocessor/main.go  — entry point
    internal/localdb/store.go — SQLite operations
  data/
    local/
      telemetry_local.db     — SQLite buffer
    raw_backup/              — CSVs archivados tras send exitoso
    failed_logs/             — CSVs que fallaron el send (retried)
    incoming_logs/           — CSVs nuevos a procesar
  proto/
    logpipeline.pb.go        — tipos generados del proto
  .env                       — GRPC_ADDRESS, SQLITE_PATH, etc.
```

---

## Variables de entorno (`.env`)

```env
GRPC_ADDRESS=145.190.8.19:50051
SQLITE_PATH=C:\Users\azureuser\Documents\csvprocessor\data\local\telemetry_local.db
LOCAL_SYNC_INTERVAL_SEC=30    # definida pero sin efecto en código
```

---

## Recovery manual (incidentes)

Si hay registros `pending` o registros `synced` que no llegaron a PostgreSQL, usar el script de recovery:

```
C:\Users\azureuser\Documents\csvprocessor\recover_pending.go
```

Lee registros `pending` de SQLite en lotes de 500, los envía por gRPC, y los marca `synced`.

Ver: [[../infraestructura/incidente-2026-07-13-csvconsumer-reconexion]]

---

## Ver también

- [[csvconsumer]] — servidor que recibe los datos
- [[../db/equipo]] — tabla donde llegan los datos en Linux
