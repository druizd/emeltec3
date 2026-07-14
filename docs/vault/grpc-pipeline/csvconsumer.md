# csvconsumer — Servidor gRPC Linux

Servicio Rust que recibe telemetría de csvprocessor (Windows) por gRPC y la inserta en PostgreSQL.

**Lenguaje:** Rust (Tokio async)
**Plataforma:** Linux VM — container Docker `emeltec-csvconsumer`
**Repo:** `grpc-pipeline/csvconsumer-rust/src/main.rs`

---

## Responsabilidades

1. Escuchar conexiones gRPC en `:50051`
2. Recibir lotes de `TelemetryRecord` de csvprocessor
3. Responder ACK inmediato (`ok = true`)
4. Encolar registros en memoria
5. Flush en batch a PostgreSQL (`equipo` hypertable)

---

## Arquitectura interna

```
gRPC handler (Tonic)
  → ACK inmediato al cliente
  → push a cola in-memory (VecDeque<TelemetryRecord>)
                ↓
      flush_task (tokio task, ticker periódico)
        → toma hasta N registros de la cola
        → INSERT INTO equipo(time, id_serial, data) — batch
        → trigger anti-duplicado descarta exactos
```

---

## Estado del cliente PostgreSQL

Usa `tokio_postgres`. La conexión devuelve **dos objetos**:
- `Client` — ejecuta queries
- `Connection` — tarea de background que mantiene el socket TCP vivo

**Si `Connection` muere** (reinicio de DB, blip de red), el `Client` queda permanentemente roto. Todas las queries devuelven `connection closed`.

### Fix implementado (pendiente deploy)

`type SharedClient = Arc<Mutex<Arc<Client>>>`

En `flush_task`, cuando el insert devuelve `e.is_closed()`:
1. Re-encola el batch con `push_front` (no se pierden datos)
2. Reconecta con backoff exponencial: `2s → 4s → 8s → ... → 60s máx`
3. Reemplaza cliente: `*shared_client.lock().await = new_client`
4. Sale del inner loop — el ticker retoma en el próximo ciclo

Ver: [[../infraestructura/incidente-2026-07-13-csvconsumer-reconexion]]

---

## Logs del container

```bash
docker logs emeltec-csvconsumer --tail=50
```

**Líneas importantes:**

| Log | Significado |
|-----|-------------|
| `lote encolado [...] cola=N modo=bulk` | Lote recibido y encolado. N = tamaño total de la cola |
| `flush: 100 registros insertados` | Batch insertado en PostgreSQL |
| `flush: 0 registros insertados` | Batch rechazado por trigger anti-duplicado (ya existía) |
| `flush error: connection closed` | **Alerta:** conexión PostgreSQL rota — requiere restart |

---

## Diagnóstico y resolución

```bash
# Ver logs recientes
docker logs emeltec-csvconsumer --tail=50

# Si ves "flush error: connection closed" en loop → restart
docker restart emeltec-csvconsumer

# Ver estado del container
docker ps | grep csvconsumer
```

---

## Gotcha crítico — ACK prematuro

csvconsumer responde ACK al gRPC **antes** de confirmar el INSERT en PostgreSQL.

Consecuencia: csvprocessor marca `synced` en SQLite aunque el dato nunca llegó a la DB. Si csvconsumer muere o su conexión PostgreSQL se rompe, los datos quedan en SQLite marcados como `synced` pero ausentes en la DB.

Esto es un riesgo de durabilidad de datos. Solución ideal: ACK solo tras INSERT exitoso (cambio pendiente de diseño).

---

## Deploy del fix de reconexión

El fix ya está en `grpc-pipeline/csvconsumer-rust/src/main.rs`. Para deployar:

```bash
# 1. En Windows: commit + push al repo
git add grpc-pipeline/csvconsumer-rust/src/main.rs
git commit -m "fix(csvconsumer): reconnect postgres on connection closed"
git push

# 2. CI buildea la imagen Docker

# 3. En Linux: restart del container
docker restart emeltec-csvconsumer
```

---

## Modo `bulk`

Los logs muestran `modo=bulk` — indica que el consumer está procesando en modo batch normal (no un modo especial). Es el único modo de operación actual.

---

## Ver también

- [[csvprocessor]] — cliente Windows que envía los datos
- [[../db/equipo]] — tabla destino en PostgreSQL
- [[../infraestructura/incidente-2026-07-13-csvconsumer-reconexion]] — incidente de reconexión
