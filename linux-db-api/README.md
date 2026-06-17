# linux-db-api

API HTTP separada en Rust para ejecutar en el servidor Linux y exponer estado de
PostgreSQL/TimescaleDB sin acoplarla a `main-api`.

## Endpoints

```text
GET /health
GET /api/db/usage?limit=10
POST /api/plc/commands
GET /api/plc/commands?status=pending&limit=20
GET /api/plc/commands/pending?limit=10
POST /api/plc/commands/:command_id/result
```

`/api/db/usage` responde con:

- estado y tamano de la DB principal Linux
- uso de conexiones
- metricas de cache, transacciones y tuplas
- estado TimescaleDB
- tablas con mayor uso de espacio
- `priority_source: "linux"` para que Windows la use como fuente primaria

`windows_sync` queda en `not_configured` hasta implementar la cola SQLite de
Windows y su sincronizacion.

## Comandos PLC

Linux es la fuente de verdad para comandos PLC. La tabla `plc_commands` vive en
PostgreSQL/TimescaleDB y el agente Windows la consulta por HTTP.

Crear comando simple (`write_tag`, formato actual):

```bash
curl -X POST http://localhost:3010/api/plc/commands \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Key: CAMBIAR' \
  -d '{"id_serial":"151.24.7.13","tag":"HR116","value":120,"command_type":"write_tag","requested_by":"admin"}'
```

Crear comando multiple (`write_tags`, formato `equipo.data`):

```bash
curl -X POST http://localhost:3010/api/plc/commands \
  -H 'Content-Type: application/json' \
  -H 'X-Internal-Key: CAMBIAR' \
  -d '{"id_serial":"151.24.7.13","command_type":"write_tags","data":{"Q1":true,"Q2":false,"HR116":1234},"requested_by":"admin"}'
```

Flujo esperado:

```text
POST /api/plc/commands                  -> status pending
Windows GET /api/plc/commands/pending   -> status sent
Windows ejecuta PLC
POST /api/plc/commands/:id/result       -> status done / failed
```

Los comandos `sent` tienen un lease. Si Windows no confirma dentro de
`PLC_COMMAND_LEASE_SEC`, Linux los vuelve a entregar. El `csvprocessor` conserva
el comando en SQLite y no repite una escritura ya ejecutada; solo reintenta el
reporte del resultado.

Antes de usar los endpoints, aplicar:

```bash
docker exec -i emeltec-db psql -U postgres -d telemetry_platform < infra-db/migrations/2026-06-01-plc-commands.sql
docker exec -i emeltec-db psql -U postgres -d telemetry_platform < infra-db/migrations/2026-06-03-plc-command-data.sql
docker exec -i emeltec-db psql -U postgres -d telemetry_platform < infra-db/migrations/2026-06-10-plc-command-leases.sql
```

## Desarrollo local

```powershell
docker compose up -d linux-db-api
curl.exe http://localhost:3010/health
curl.exe "http://localhost:3010/api/db/usage?limit=3"
```

Variables usadas:

```env
PORT=3010
DB_HOST=timescaledb
DB_PORT=5432
DB_NAME=telemetry_platform
DB_USER=postgres
DB_PASSWORD=...
RUST_LOG=info
INTERNAL_API_KEY=CAMBIAR
PLC_COMMAND_LEASE_SEC=60
```
