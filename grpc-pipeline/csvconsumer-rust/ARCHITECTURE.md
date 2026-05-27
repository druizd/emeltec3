# csvconsumer — Arquitectura

Servidor gRPC escrito en Rust que recibe lotes de telemetría desde csvprocessor (Windows) y los inserta en PostgreSQL/TimescaleDB.

---

## Posición en el pipeline

```
csvprocessor (Windows, Go)
    └──gRPC:50051──▶ csvconsumer (Linux, Rust)
                          └──SQL──▶ PostgreSQL/TimescaleDB
                                        tabla: equipo
```

---

## Flujo de SendRecords

```
Request (lote de TelemetryRecord)
    │
    ├─ lote vacío? → ok=true, inserted=0
    │
    ├─ validación mínima por registro:
    │    id_serial, fecha, hora, data no vacíos
    │    → primer fallo: ok=true, inserted=0, message=descripción
    │
    └─ INSERT fila por fila en tabla equipo:
         time      = (fecha || ' ' || hora)::timestamptz AT TIME ZONE 'UTC'
         id_serial = string
         data      = JSONB  (ej: {"AI23": 1.5, "REG4": 0.0})
         │
         ├─ ok → inserted++
         └─ error BD → Status::internal (error gRPC, el processor reintenta)
```

---

## Contrato gRPC (logpipeline.proto)

```protobuf
service LogIngestion {
  rpc Ping(PingRequest)              returns (PingResponse);
  rpc SendRecords(SendRecordsRequest) returns (SendRecordsResponse);
}

message TelemetryRecord {
  string id_serial = 1;
  string fecha     = 2;  // "2026-05-15"
  string hora      = 3;  // "22:00:00"
  string data      = 4;  // JSON: {"AI23": 1.5, "REG4": 0.0}
}

message SendRecordsResponse {
  bool   ok         = 1;
  int32  inserted   = 2;
  int32  duplicates = 3;  // siempre 0 (sin ON CONFLICT aún)
  string message    = 4;
}
```

---

## Tabla destino

```sql
-- tabla: equipo (TimescaleDB hypertable)
time      TIMESTAMPTZ   -- índice temporal principal
id_serial TEXT          -- identifica el dispositivo (ej: 151.20.35.10)
data      JSONB         -- variables del equipo para ese segundo
```

---

## Configuración (.env)

| Variable         | Default                     | Descripción                                                                 |
| ---------------- | --------------------------- | --------------------------------------------------------------------------- |
| `GRPC_PORT`      | `50051`                     | Puerto donde escucha el servidor                                            |
| `DB_HOST`        | `host.docker.internal`      | Host de PostgreSQL                                                          |
| `DB_PORT`        | `5433`                      | Puerto de PostgreSQL                                                        |
| `DB_NAME`        | `db_infra`                  | Base de datos                                                               |
| `DB_USER`        | `admin_infra`               | Usuario                                                                     |
| `DB_PASSWORD`    | `CHANGE_ME_STRONG_PASSWORD` | Contraseña (nunca dejar vacío en producción)                                |
| `DB_SSLMODE`     | `disable`                   | sslmode PostgreSQL — usar `require` fuera de red Docker privada             |
| `GRPC_API_KEY`   | _(vacío)_                   | API key para auth gRPC (`x-api-key` en metadata) — configurar en producción |
| `GRPC_BIND_HOST` | `0.0.0.0`                   | Bind address del servidor gRPC                                              |

---

## Stack técnico

| Crate            | Rol                                             |
| ---------------- | ----------------------------------------------- |
| `tonic 0.12`     | Framework gRPC (servidor + codecs)              |
| `prost 0.13`     | Serialización protobuf                          |
| `tokio`          | Runtime async multi-hilo                        |
| `tokio-postgres` | Driver async PostgreSQL (sin libpq)             |
| `dotenvy`        | Carga opcional de `.env`                        |
| `tonic-build`    | Genera código Rust desde `.proto` en build time |

---

## Despliegue (Docker — Linux)

```dockerfile
# Build stage: compila Rust release con protobuf-compiler
FROM rust:1.85-bookworm AS builder
# Runtime stage: imagen mínima debian:bookworm-slim
FROM debian:bookworm-slim
EXPOSE 50051
CMD ["csvconsumer"]
```

```bash
docker build -f csvconsumer-rust.Dockerfile -t csvconsumer .
docker run -d --env-file csvconsumer/.env -p 50051:50051 csvconsumer
```

---

## Producción (Azure Linux — 10.1.0.5)

- Corre como contenedor Docker en Linux VM
- Puerto 50051 expuesto públicamente (alcanzable desde Windows VM vía IP pública)
- PostgreSQL/TimescaleDB en contenedor separado (puerto 5433)
- Sin TLS en gRPC (red interna/privada)
