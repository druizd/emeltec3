---
aliases: [arquitectura, overview infra, como funciona, sistema completo]
tags: [vault/infrastructure]
---

# Arquitectura General — Emeltec Cloud

← [[HOME]] | Ver también: [[servicios]] · [[monitor-alertas]] · [[backup-db]] · [[justificacion/infraestructura-cloud]]

---

## Vista de 30,000 pies

```mermaid
graph TD
    subgraph EXT ["🌍 Externo"]
        SENSOR["Sensores industriales\n(pozos · salas frías · procesos)"]
        DGA["🏛️ SNIA / MOP\nDGA"]
        USER["👤 Cliente\ncloud.emeltec.cl"]
        RESEND["📧 Resend API\nalertas por correo"]
        BLOB["☁️ Azure Blob\nbackups"]
    end

    subgraph WIN ["🖥️ VM Windows — Azure"]
        FTPPROC["ftpprocessor\nGo · watcher 500ms"]
        SQLITE[("SQLite\ncola pending")]
    end

    subgraph LIN ["🐧 VM Linux 145.190.8.19 — Azure"]
        NGINX["nginx\nreverse proxy"]
        API["emeltec-api\nNode.js :3000"]
        AUTH["emeltec-auth\nNode.js :3001"]
        LDBAPI["linux-db-api\nRust :3010"]
        FE["emeltec-frontend\nAngular :5173"]
        FTPC["emeltec-ftpconsumer\nRust gRPC :50061"]
        CSVC["emeltec-csvconsumer\nRust gRPC :50051"]
        DB[("emeltec-db\nTimescaleDB :5433")]
        REDIS[("emeltec-redis\nRedis")]
        MONITOR["monitor.sh\ncron */5min"]
        BACKUP["backup-db.sh\ncron 03:00 AM"]
    end

    SENSOR -->|CSV raw| FTPPROC
    FTPPROC --- SQLITE
    FTPPROC -->|"gRPC batch\n:50061"| FTPC
    FTPC -->|INSERT equipo| DB

    CSVC -->|INSERT equipo| DB

    NGINX --> FE
    NGINX --> API
    NGINX --> AUTH
    USER -->|HTTPS| NGINX

    API --> DB
    API --> REDIS
    AUTH --> DB
    AUTH --> API
    LDBAPI --> DB

    API -->|workers DGA| DGA

    MONITOR -->|docker inspect| LIN
    MONITOR -->|psql query| DB
    MONITOR -->|HTTP POST| RESEND

    BACKUP -->|pg_dump| DB
    BACKUP -->|az upload| BLOB

    style DB fill:#336699,color:#fff
    style REDIS fill:#cc3333,color:#fff
    style FTPPROC fill:#0078d4,color:#fff
    style DGA fill:#1e40af,color:#fff
    style RESEND fill:#d97706,color:#fff
    style BLOB fill:#0078d4,color:#fff
```

---

## Las dos pipelines de datos

### Pipeline FTP — sensores de campo

```mermaid
sequenceDiagram
    participant S  as Sensor / Dispositivo
    participant FTP as Servidor FTP
    participant W  as ftpprocessor (Win)
    participant Q  as SQLite queue
    participant FC as ftpconsumer (Linux)
    participant DB as TimescaleDB

    S->>FTP: CSV raw (semicolón, DD-MM-YYYY HH:MM)
    Note over FTP: archivo queda en /ftp/SERIAL/

    loop cada 500ms
        W->>FTP: watcher detecta archivo nuevo
        W->>W: parsea CSV → normaliza timestamp
        W->>W: agrupa por timestamp (deduplicación)
        W->>Q: INSERT pending (si no puede enviar)
    end

    W->>FC: gRPC SendBatch (max 200 records)
    FC->>DB: INSERT INTO equipo (time, serial, val1..val8)
    FC-->>W: OK / error

    Note over DB: hypertable particionada por tiempo
    Note over DB: cagg equipo_1min → actualiza en ~2min
```

**Identificación:** `received_at IS NULL` en tabla `equipo` = dato FTP.

---

### Pipeline gRPC/CSV — csvconsumer

```mermaid
sequenceDiagram
    participant SRC as Fuente externa
    participant CSV as emeltec-csvconsumer
    participant DB  as TimescaleDB

    SRC->>CSV: gRPC :50051
    CSV->>DB: INSERT INTO equipo (time, serial, val1..val8, received_at=NOW())
    Note over DB: received_at NOT NULL = dato CSV/gRPC
```

**Identificación:** `received_at IS NOT NULL` en tabla `equipo` = dato csvconsumer.

---

## Stack de contenedores Linux

```mermaid
graph LR
    subgraph PUBLIC ["Puerto público (0.0.0.0)"]
        FTPC["emeltec-ftpconsumer\n:50061"]
        CSVC["emeltec-csvconsumer\n:50051"]
        LDBAPI["emeltec-linux-db-api\n:3010"]
    end

    subgraph NGINX_GW ["nginx (gateway)"]
        direction TB
        GW["nginx\n:80 / :443"]
    end

    subgraph PRIVATE ["Loopback (127.0.0.1)"]
        FE["emeltec-frontend\n:5173"]
        API["emeltec-api\n:3000"]
        AUTH["emeltec-auth\n:3001"]
    end

    subgraph DATA ["Datos"]
        DB[("TimescaleDB\n:5433")]
        RED[("Redis\ninterno")]
    end

    GW --> FE
    GW --> API
    GW --> AUTH

    API --> DB
    API --> RED
    AUTH --> DB
    AUTH --> API
    LDBAPI --> DB
    FTPC --> DB
    CSVC --> DB
```

> [!warning] Puertos públicos
> `50051`, `50061`, `3010` son accesibles desde internet — protegidos únicamente por NSG de Azure y autenticación interna (`x-internal-key`).

---

## Datos en la base de datos

```mermaid
erDiagram
    empresa ||--o{ sitio : tiene
    sitio ||--o{ sitio_equipo : contiene
    sitio_equipo ||--o{ equipo : genera
    sitio ||--o| pozo_config : configura
    sitio ||--o{ dato_dga : reporta

    empresa {
        bigint id PK
        text nombre
        text tipo_empresa
    }

    sitio {
        bigint id PK
        text nombre
        bigint empresa_id FK
        text tipo_sitio
    }

    sitio_equipo {
        bigint id PK
        bigint sitio_id FK
        text serial
    }

    equipo {
        timestamptz time PK
        text serial
        float8 val1
        float8 val8
        timestamptz received_at
    }

    dato_dga {
        timestamptz time PK
        bigint sitio_id FK
        text estado
    }
```

---

## Pipeline DGA (dentro de main-api)

```mermaid
flowchart TD
    subgraph WORKERS ["Workers en main-api (Node.js)"]
        direction TB
        PS["preseed.ts\ncada 6h\nCrea filas dato_dga vacías"]
        FI["worker.ts\ncada 60s\nLlena dato_dga desde equipo_1min"]
        RE["reconciler.ts\ncada 1h\nRe-intenta errores"]
        SU["submission.ts\ncada 5min\n⚠️ DESHABILITADO"]
    end

    DB[("TimescaleDB")]
    SNIA["🏛️ SNIA/MOP"]

    DB --> PS
    DB --> FI
    DB --> RE
    RE -->|reintento| SNIA
    SU -.->|deshabilitado| SNIA

    PS --> DB
    FI --> DB

    style SU fill:#dc2626,color:#fff,stroke:#ef4444
    style SNIA fill:#1e40af,color:#fff
```

> [!danger] `submission.ts` deshabilitado
> `ENABLE_DGA_SUBMISSION_WORKER=false` — no cambiar sin autorización de gerencia.

---

## Sistema de monitoreo y alertas

```mermaid
flowchart TD
    CRON(["⏰ cron */5 * * * *"])
    CRON --> MON["monitor.sh"]

    MON --> CC["check_container()\npor cada container"]
    MON --> CF1["check_flow() csv\nWHERE received_at IS NOT NULL"]
    MON --> CF2["check_flow() ftp\nWHERE received_at IS NULL"]

    CC --> SI{docker inspect}
    SI -->|no existe| MISS["state: missing\n📧 email rojo"]
    SI -->|stopped| DOWN["state: down\n📧 email rojo + logs"]
    SI -->|running + prev=down| REC["state: ok\n📧 email verde recuperado"]
    SI -->|running| OK1["log OK"]

    CF1 --> QDB{psql query\nmin desde último dato}
    CF2 --> QDB

    QDB -->|">= 10 min"| RED["state: red\n📧 email rojo crítico"]
    QDB -->|">= 5 min"| YEL["state: yellow\n📧 email amarillo"]
    QDB -->|"< 5 min + prev=yellow/red"| REC2["state: ok\n📧 email verde recuperado"]
    QDB -->|"< 5 min"| OK2["log OK"]

    RED --> RESEND["📧 Resend API"]
    YEL --> RESEND
    REC --> RESEND
    REC2 --> RESEND
    MISS --> RESEND
    DOWN --> RESEND

    style RED fill:#dc2626,color:#fff
    style MISS fill:#dc2626,color:#fff
    style DOWN fill:#dc2626,color:#fff
    style YEL fill:#d97706,color:#fff
    style REC fill:#16a34a,color:#fff
    style REC2 fill:#16a34a,color:#fff
```

**Anti-spam:** estado persistido en `/tmp/emeltec-monitor/` — solo manda email cuando el estado **cambia**.

---

## Sistema de backup

```mermaid
flowchart LR
    CRON(["⏰ cron 0 3 * * *\n3:00 AM"])
    CRON --> SC["backup-db.sh"]
    SC --> PG["docker exec emeltec-db\npg_dump -Fc --compress=9"]
    PG --> TMP["💾 /tmp/emeltec-backups/\nbackup_YYYYMMDD_HHMMSS.dump\n~1.5 GB comprimido"]
    TMP --> AZ["az storage blob upload\nHot tier"]
    AZ --> BLOB[("☁️ Azure Blob\ndb-backups/")]
    AZ --> RM["🗑️ rm archivo local"]
    BLOB -->|"día 15"| LC["Lifecycle Policy\nborra automático"]

    style BLOB fill:#0078d4,color:#fff
    style LC fill:#6b7280,color:#fff
```

Costo: **$0.38/mes** — ver [[azure-blob-storage]].

---

## Resiliencia — qué pasa cuando algo falla

| Fallo | Detección | Recuperación automática | Pérdida de datos |
|---|---|---|---|
| Container cae | monitor.sh en <5 min → email | Docker restart policy | Ninguna |
| VM Linux cae | monitor.sh no puede correr | Manual: `docker compose up` | Ninguna (SQLite queue en Win) |
| ftpprocessor cae | monitor.sh → email | Manual | Datos en FTP server esperan |
| DB corrupta | monitor.sh → email | Restaurar desde backup | Máximo 24h |
| Red entre VMs cortada | ftpprocessor → SQLite queue | Auto-reenvío al reconectar | Ninguna |

---

## Archivos clave

| Archivo | Función |
|---|---|
| `scripts/monitor.sh` | Monitor de salud + alertas por email |
| `scripts/backup-db.sh` | Backup diario a Azure Blob |
| `docker-compose.yml` | Definición de todos los containers Linux |
| `infra-db/init-db/01-init-schema.sql` | Schema inicial de la DB |
| `infra-db/migrations/*.sql` | Cambios incrementales al schema (aplicar en orden) |
| `ftp-pipeline/ftpprocessor/` | Código Go del procesador FTP (Windows) |
| `ftp-pipeline/ftpconsumer-rust/` | Código Rust del receptor gRPC (Linux) |
| `grpc-pipeline/csvconsumer/` | Código Rust del consumer CSV/gRPC |
| `main-api/` | API principal Node.js + workers DGA |
