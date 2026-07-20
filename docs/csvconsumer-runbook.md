# csvconsumer — Runbook de arquitectura y recuperación

Servicio Rust que recibe telemetría desde csvprocessor (Windows) vía gRPC y la inserta en PostgreSQL/TimescaleDB con garantía de durabilidad.

---

## Origen del problema — por qué existe el WAL

### Incidente: pérdida de datos 10–14 julio 2026

**Qué se perdió:** registros de telemetría de equipos industriales (variables de proceso, agua, etc.) correspondientes al período 10–14 de julio de 2026. Los datos nunca llegaron a la tabla `equipo` en TimescaleDB.

**Cómo se detectó:** revisión manual de la base de datos. Se notó un hueco en la serie temporal — registros que debían existir según los archivos CSV en `raw_backup/` no aparecían en PostgreSQL. Los backups confirmaron que los archivos habían sido procesados (csvprocessor los había borrado del `incoming_logs/`), lo que indicaba que el ACK había sido recibido correctamente.

**Causa raíz:** el flujo original tenía el siguiente orden:

```
1. csvprocessor envía gRPC
2. csvconsumer encola en memoria (RAM)
3. csvconsumer ACKea → csvprocessor borra el archivo CSV
4. [background] flush_task intenta INSERT en PostgreSQL
   ↑
   Si csvconsumer se reiniciaba entre 3 y 4, los datos en memoria se perdían.
   csvprocessor ya había borrado el CSV. No había forma de recuperar esos registros.
```

El hueco exacto era entre el ACK (paso 3) y el INSERT real (paso 4). Cualquier reinicio del contenedor en ese intervalo — por deploy, OOM, o falla del host — causaba pérdida silenciosa de datos.

**Qué se hizo:** se introdujo el WAL (Write-Ahead Log) en SQLite local **antes** del ACK. El nuevo orden es:

```
1. csvprocessor envía gRPC
2. csvconsumer escribe en WAL SQLite (done=0)   ← NUEVO
3. csvconsumer encola en memoria
4. csvconsumer ACKea → csvprocessor borra CSV
5. [background] flush_task INSERT en PostgreSQL
6. WAL marcado done=1                           ← NUEVO
```

Ahora si el proceso muere entre 4 y 5, al reiniciar carga los registros con `done=0` del WAL y los reintenta. El archivo CSV ya fue borrado en Windows, pero el WAL en Linux tiene los datos.

---

## Arquitectura general

```
[Windows — csvprocessor (Go)]
  incoming_logs/<archivo>
    → copia a raw_backup/<id_serial>/<YYYY-WNN>/
    → lee CSV
    → parsea a records (protobuf)
    → guarda en SQLite local (estado: pending)
    → gRPC SendRecords ──────────────────────────────► [Linux — csvconsumer (Rust)]
                                                              │
                                                              ├─ 1. WAL: INSERT en SQLite local (done=0)
                                                              ├─ 2. Encola en memoria (VecDeque)
                                                              └─ 3. ACK "ok: true"
    ◄── recibe ACK ─────────────────────────────────────────────────────────────────
    → marca SQLite local como synced
    → elimina archivo CSV original

                                        [background — cada 3 segundos]
                                        flush_task:
                                          → toma lote de la cola (3 normal / 100 bulk)
                                          → INSERT INTO equipo (TimescaleDB)
                                          → marca WAL done=1
                                          → si falla: reencola + reconecta con backoff (2s→60s)
```

### Por qué importa el orden ACK → INSERT

El ACK se envía **después** de escribir el WAL, **antes** de insertar en PostgreSQL.

| Escenario                               | Resultado                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| csvconsumer se reinicia después del ACK | WAL tiene `done=0` → se recuperan solos al arrancar                                                         |
| PostgreSQL se cae después del ACK       | Lote reencola + reconexión con backoff → inserta cuando vuelve                                              |
| csvconsumer se reinicia antes del ACK   | csvprocessor no recibió ACK → reintenta → WAL puede tener duplicado → PostgreSQL descarta con `ON CONFLICT` |

**Sin el WAL**, el hueco entre ACK y INSERT en PostgreSQL fue la causa de la pérdida de datos del 10–14 de julio 2026.

---

## Componentes del servicio

### WAL (Write-Ahead Log) — SQLite local

**Archivo:** `/data/csvconsumer-wal.db` (volumen Docker `csvconsumer_wal`)

```sql
CREATE TABLE pending_records (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha     TEXT NOT NULL,
    hora      TEXT NOT NULL,
    id_serial TEXT NOT NULL,
    data      TEXT NOT NULL,
    done      INTEGER NOT NULL DEFAULT 0  -- 0=pendiente, 1=insertado en PG
);
```

- `PRAGMA journal_mode=WAL` — escrituras concurrentes sin bloquear lecturas
- `PRAGMA synchronous=NORMAL` — balance entre rendimiento y durabilidad
- Limpieza cada 100 flushes exitosos: `DELETE WHERE done=1`

### Cola en memoria — VecDeque

Registros en RAM esperando flush a PostgreSQL. Se pierde si el proceso muere, pero el WAL la reconstruye al arrancar.

### flush_task — background tokio

Tick cada 3 segundos. Dos modos:

| Condición       | Tamaño de lote            |
| --------------- | ------------------------- |
| Cola ≤ 10 items | 3 registros (modo normal) |
| Cola > 10 items | 100 registros (modo bulk) |

Si el INSERT falla:

1. Reencola el lote en el frente de la cola
2. Si el error es `is_closed()` → backoff exponencial: 2s → 4s → 8s … → 60s máx
3. Rompe el inner loop; el ticker maneja el próximo intento

### Servidor gRPC — tonic

Puerto `50051`. Dos endpoints:

- `Ping` — healthcheck
- `SendRecords` — recibe lote, valida campos, persiste WAL, encola, ACK

---

## Variables de entorno

| Variable      | Default                    | Descripción                                     |
| ------------- | -------------------------- | ----------------------------------------------- |
| `GRPC_PORT`   | `50051`                    | Puerto gRPC del servidor                        |
| `WAL_DB_PATH` | `/data/csvconsumer-wal.db` | Ruta del SQLite WAL                             |
| `DB_HOST`     | `timescaledb`              | Host PostgreSQL (nombre servicio Docker)        |
| `DB_PORT`     | `5432`                     | Puerto PostgreSQL interno                       |
| `DB_NAME`     | `db_infra`                 | Nombre de la base de datos                      |
| `DB_USER`     | `admin_infra`              | Usuario PostgreSQL                              |
| `DB_PASSWORD` | _(vacío)_                  | Password PostgreSQL (obligatorio en producción) |

En producción se inyectan desde el bloque `x-db-env` del `docker-compose.yml` + `.env` raíz.

---

## Despliegue

### Imagen Docker

```dockerfile
# Build stage: rust:1.85-bookworm + protobuf-compiler
# Runtime stage: debian:bookworm-slim (binario estático copiado)
# Usuario: nobody (sin root)
# Volumen: /data (WAL SQLite)
```

### Comandos útiles

```bash
# Ver logs en vivo
docker logs -f emeltec-csvconsumer

# Reiniciar sin perder datos (WAL sobrevive)
docker compose restart csvconsumer

# Reconstruir y desplegar imagen nueva
docker compose up -d --build csvconsumer

# Ver estado del WAL desde el host
docker exec emeltec-csvconsumer \
  sqlite3 /data/csvconsumer-wal.db \
  "SELECT count(*) as total, sum(done) as procesados FROM pending_records;"

# Ver registros pendientes (done=0)
docker exec emeltec-csvconsumer \
  sqlite3 /data/csvconsumer-wal.db \
  "SELECT * FROM pending_records WHERE done=0 LIMIT 20;"
```

---

## Runbook — qué hacer si deja de funcionar

### 1. Diagnóstico inicial

```bash
# Estado del contenedor
docker ps | grep csvconsumer

# Logs recientes (últimas 100 líneas)
docker logs --tail 100 emeltec-csvconsumer

# Salida del último error
docker logs emeltec-csvconsumer 2>&1 | grep -E "error|Error|panic|FATAL" | tail -20
```

### 2. Contenedor caído (`Exited` o no existe)

```bash
# Reiniciar (el WAL recupera automáticamente registros pendientes)
docker compose up -d csvconsumer

# Verificar que arrancó y recuperó WAL
docker logs emeltec-csvconsumer 2>&1 | grep "WAL\|🚀\|✅"
# Debe aparecer:
#   ⚠️  WAL: recuperando N registros pendientes del reinicio anterior
#   ✅ conexión a PostgreSQL exitosa
#   🚀 csvconsumer puerto=50051 ...
```

### 3. Contenedor vivo pero no inserta en PostgreSQL

**Síntoma:** logs con `flush error` repetido.

```bash
# Ver si reconecta (backoff exponencial)
docker logs -f emeltec-csvconsumer | grep "reconect"

# Si no reconecta: verificar PostgreSQL
docker ps | grep emeltec-db
docker logs emeltec-db --tail 50

# Reiniciar PostgreSQL si está caído
docker compose restart timescaledb

# csvconsumer detecta la reconexión solo (backoff hasta 60s)
# No es necesario reiniciar csvconsumer
```

### 4. Puerto 50051 inaccesible desde csvprocessor (Windows)

```bash
# Verificar que el puerto está abierto en el host Linux
ss -tlnp | grep 50051

# Verificar regla de firewall Azure NSG
# (el puerto debe estar en la allowlist del NSG para la IP del Windows)

# Ping gRPC manual desde Linux
# (requiere grpcurl instalado)
grpcurl -plaintext localhost:50051 logpipeline.LogIngestion/Ping
```

### 5. WAL creció demasiado (acumulación de done=1)

```bash
# Ver tamaño del archivo
docker exec emeltec-csvconsumer ls -lh /data/csvconsumer-wal.db

# Limpieza manual (solo si el servicio está corriendo y con flush activo)
docker exec emeltec-csvconsumer \
  sqlite3 /data/csvconsumer-wal.db \
  "DELETE FROM pending_records WHERE done=1;"
```

### 6. Pérdida total del volumen WAL (caso extremo)

Si el volumen `csvconsumer_wal` se pierde (error de disco, recreación accidental):

1. El contenedor arranca sin WAL → lo crea vacío automáticamente
2. Los registros que estaban en cola **en memoria** al momento de la caída se pierden
3. csvprocessor tiene su propio SQLite local con estado `pending` → reintentará enviar esos registros al próximo ciclo
4. No hay acción manual necesaria; csvprocessor es el emisor autoritativo

> **Precaución:** nunca hacer `docker compose down -v` en producción. Eso elimina todos los volúmenes incluyendo `timescale_data` y `csvconsumer_wal`.

---

## Flujo de datos completo (referencia rápida)

```
csvprocessor (Windows, Go)              csvconsumer (Linux, Rust)
─────────────────────────────           ──────────────────────────────────────
archivo CSV detectado
  │
  ├─ copia raw_backup/
  ├─ parsea registros protobuf
  ├─ SQLite local → pending
  └─ gRPC SendRecords ────────────────► recibe lote
                                          │
                                          ├─ valida campos (id_serial, fecha, hora, data)
                                          ├─ WAL INSERT done=0   ← DURABILIDAD
                                          ├─ encola en VecDeque
                                          └─ ACK ok:true
  ◄──────────────────────────────────────
  ├─ SQLite local → synced
  └─ elimina CSV original
                                        [cada 3s — flush_task]
                                          ├─ toma lote de VecDeque
                                          ├─ INSERT INTO equipo (TimescaleDB)
                                          ├─ WAL UPDATE done=1
                                          └─ si error → reencola + backoff
```

---

## Archivos relevantes

| Archivo                                       | Descripción                               |
| --------------------------------------------- | ----------------------------------------- |
| `grpc-pipeline/csvconsumer-rust/src/main.rs`  | Código fuente completo del servicio       |
| `grpc-pipeline/csvconsumer-rust/Cargo.toml`   | Dependencias Rust                         |
| `grpc-pipeline/csvconsumer-rust.Dockerfile`   | Imagen Docker (build + runtime)           |
| `grpc-pipeline/proto/`                        | Definición protobuf del contrato gRPC     |
| `docker-compose.yml` → servicio `csvconsumer` | Variables de entorno, volumen WAL, puerto |
| `.env` (raíz, gitignored)                     | Credenciales PostgreSQL en producción     |
