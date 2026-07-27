---
aliases: [latencia ftp, optimizacion ftpprocessor, dedup, connection pool]
tags: [vault/ftp, investigacion, performance]
---

# Investigación de latencia — FTP Pipeline (2026-07-23)

← [[HOME]] | Ver también: [[ftpprocessor]] · [[ftp-dispositivos]]

---

## Problema

Los logs mostraban tiempos inaceptables para archivos de apenas 2 registros:

```
ok ftp (REGADIO) REGADIO_20260723083519.csv | attempt 1/3 | records: 2 | 663ms
ok ftp (REGADIO) REGADIO_20260723084244.csv | attempt 1/3 | records: 2 | 4215ms
ok ftp (REGADIO) REGADIO_20260723084630.csv | attempt 1/3 | records: 2 | 12193ms
```

Comparado con csvprocessor (mismo servidor, mismo gRPC):
```
ok log (151.21.35.27--1) 2026_07_23_08_43_58.csv | attempt 1/3 | records: 1 | 7ms
```

Diferencia de **100x** para archivos del mismo tamaño.

---

## Análisis de causas raíz

### Causa 1 — Contención SQLite (varianza 1400–4000ms)

**Síntoma:** archivos lentos tenían `sqlite sync ok | records: 200` pegado antes o después en el log.

**Causa:** `MarkTelemetrySynced` hacía N UPDATEs **individuales** en loop. Con 135K registros pendientes, `retryPendingTelemetry` corría constantemente haciendo 200 UPDATEs uno a uno. Con `MaxOpenConns(1)`, todos los accesos SQLite se serializan en una sola conexión — `processFile` quedaba bloqueado esperando.

```go
// ❌ ANTES — 200 Exec() separados, cada uno adquiere y suelta la conexión
for _, id := range ids {
    s.db.Exec(`UPDATE telemetry_records SET sync_status = 'synced' WHERE local_id = ?`, id)
}

// ✅ DESPUÉS — 1 Exec() con IN clause
s.db.Exec(`UPDATE telemetry_records SET sync_status = 'synced' WHERE local_id IN (?,?,?...)`, args...)
```

### Causa 2 — Archivos `_log_` explotando la latencia a 12000ms

**Síntoma:**
```
warn ftp (REGADIO) REGADIO_log_20260501_20260531.csv | gRPC: message length too large: 8587388 bytes, limit: 4194304 bytes
ok ftp (REGADIO) ... | 12193ms   ← workers bloqueados
ok ftp (CASINO)  ... | 12407ms
```

**Causa:** Los archivos históricos `_log_` son dumps mensuales de ~8MB. Sin filtro, el pipeline intentaba enviarlos por gRPC 3 veces con error `OutOfRange` en cada intento. Cada intento tardaba ~4000ms → 3 intentos = 12000ms que bloqueaba los workers concurrentes.

```go
// ✅ FIX — mover a hold_corrupt inmediatamente sin intentar gRPC
if strings.Contains(strings.ToLower(fileName), "_log_") {
    os.Rename(filePath, filepath.Join(cfg.HoldCorruptDir, fileName))
    return
}
```

### Causa 3 — Floor de ~640ms (incluso sin contención)

**Síntoma:** incluso en momentos sin `sqlite sync ok` visible, el mínimo era 600–700ms para 2 registros. Inspeccionando ftpconsumer-rust:

```rust
// ❌ ANTES — Mutex global = 1 sola conexión PostgreSQL para TODOS los gRPC calls
struct ConsumerService {
    db: Arc<Mutex<Client>>,
}

async fn send_records(&self, req: ...) {
    let mut client = self.db.lock().await;  // ← SERIALIZA TODO ACÁ
    insert_records(&mut client, &parsed).await
}
```

**Causa:** Con `Arc<Mutex<Client>>`, cuando `retryPendingTelemetry` mandaba un batch de 200 records, ftpconsumer los insertaba uno a uno en una transacción. Durante esa transacción (que podía tomar 400–600ms), cualquier call de `processFile` esperaba bloqueado en `self.db.lock().await`.

---

## Cambios implementados

### ftpprocessor — `internal/localdb/store.go`

#### `FilterDuplicates` — usa PRIMARY KEY composite (no full scan)

```go
// ❌ ANTES — concatenación impide usar el índice → O(n) full scan sobre dedup_log
args[i] = r.IDSerial + "|" + r.Fecha + "|" + r.Hora
rows = db.Query(`... WHERE id_serial || '|' || fecha || '|' || hora IN (?, ?)`, args...)

// ✅ DESPUÉS — row-value constructor → usa PRIMARY KEY (id_serial, fecha, hora) → O(log n)
args[i*3], args[i*3+1], args[i*3+2] = r.IDSerial, r.Fecha, r.Hora
rows = db.Query(`... WHERE (id_serial, fecha, hora) IN ((?,?,?),(?,?,?))`, args...)
```

**Por qué importa:** `dedup_log` acumula todos los registros enviados (retención 90 días). Con 340K+ filas, un full scan por cada archivo procesado se convierte en el principal consumidor de tiempo.

#### `MarkDeduped` — bulk INSERT con chunks (no loop de transacciones)

```go
// ❌ ANTES — tx con N INSERTs individuales → retiene la única conexión SQLite
tx.Begin()
for _, r := range records { tx.Exec(`INSERT ... VALUES (?,?,?)`, r.IDSerial, r.Fecha, r.Hora) }
tx.Commit()

// ✅ DESPUÉS — un solo INSERT multi-row por chunk de 300
// SQLite limit: 999 params / 3 cols = 333 max → chunk de 300 para margen
db.Exec(`INSERT OR IGNORE INTO dedup_log VALUES (?,?,?),(?,?,?),(?,?,?)...`, args...)
```

#### `MarkTelemetrySynced` / `MarkTelemetryFailed` — batch IN clause

Mismo patrón: de N Exec() individuales a 1 sola query con `IN (?,?,?,...)`.

### ftpprocessor — `cmd/ftpprocessor/main.go`

#### Conexión gRPC compartida

```go
// ❌ ANTES — nueva conexión gRPC por cada archivo + por cada retry batch
sender.SendRecords(ctx, cfg.GRPCAddress, ...)  // creaba conn internamente

// ✅ DESPUÉS — 1 conexión persistente compartida entre todos los workers
conn, _ := sender.Dial(cfg.GRPCAddress)  // al inicio
sender.SendRecords(ctx, conn, ...)        // reutiliza
```

#### Step-timing en `runPipeline` (diagnóstico)

Agrega una línea de timing por archivo para identificar el step más costoso:

```
timing ftp (REGADIO) REGADIO_20260723083519.csv | read:2ms parse:1ms dedup:0ms backup:12ms sqlite:8ms grpc:580ms mark:3ms
```

Si `grpc` aparece alto → confirma que el problema era ftpconsumer. Si `backup` es alto → mover `CopyToBackupBySerial` a goroutine. Si `sqlite` es alto → aumentar `MaxOpenConns`.

### ftpconsumer-rust — `src/main.rs` + `Cargo.toml`

#### `Arc<Mutex<Client>>` → `deadpool_postgres::Pool`

```rust
// ❌ ANTES
struct ConsumerService { db: Arc<Mutex<Client>> }
let mut client = self.db.lock().await;  // bloquea todos los callers

// ✅ DESPUÉS
struct ConsumerService { pool: Pool }
let mut client = self.pool.get().await?;  // conexión independiente por call
insert_records(&mut *client, &parsed).await
```

**Dependency agregada en Cargo.toml:**
```toml
deadpool-postgres = { version = "0.12", features = ["rt_tokio_1"] }
```

**Beneficio:** cada gRPC call obtiene su propia conexión del pool. Los batches de `retryPendingTelemetry` (200 records) y los archivos nuevos de `processFile` (2 records) corren en paralelo sin bloquearse.

---

## Beneficios esperados

| Métrica | Antes | Esperado |
|---|---|---|
| `ok ftp` baseline | ~640ms | ~20–100ms |
| `ok ftp` con retry activo | 1400–4000ms | similar al baseline |
| `ok ftp` con archivo `_log_` | 12000ms | eliminado (hold_corrupt) |
| `sqlite sync ok` frecuencia | constante, bloquea | sin cambio en frecuencia, sin bloqueo |

---

## Plan de validación (sábado 2026-07-26)

1. Deploy del código actual en Linux:
   ```bash
   docker compose build ftpconsumer ftpprocessor
   docker compose up -d ftpconsumer
   # instalar ftpprocessor.exe en Windows service
   ```
2. Observar los logs de `timing ftp` — el campo `grpc:` confirma o descarta ftpconsumer como cuello de botella.
3. Si `grpc: <50ms` → el pool fue el fix. Si `grpc: >400ms` → investigar TimescaleDB.
4. Hacer PR de ftpconsumer (recordatorio enviado por email el sábado a las 10:00 AM).

---

> [!note] Pendiente
> `SaveTelemetryBatch` todavía hace N×2 queries (1 INSERT + 1 SELECT por record en tx). Para 2 records es insignificante. Si el volumen de records por archivo crece, revisar bulk INSERT + single SELECT con map.
