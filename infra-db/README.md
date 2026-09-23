# 🗄️ infra-db — Infraestructura de Base de Datos

Esta carpeta contiene la configuración de **Docker Compose** para levantar la base de datos del proyecto.

---

## 📦 Servicios incluidos

| Servicio        | Imagen Docker                       | Puerto Local | Descripción                                                |
| --------------- | ----------------------------------- | ------------ | ---------------------------------------------------------- |
| **TimescaleDB** | `timescale/timescaledb:latest-pg16` | `5433`       | Base de datos PostgreSQL optimizada para series temporales |
| **pgAdmin 4**   | `dpage/pgadmin4:latest`             | `5050`       | Interfaz web para administrar la BD visualmente            |

---

## 🚀 Cómo levantar

```bash
# 1. Crear tu archivo de variables de entorno
cp .env.example .env
# Edita .env con tus contraseñas

# 2. Levantar los contenedores
docker compose up -d

# 3. Verificar que estén corriendo
docker ps
```

### Acceder a pgAdmin

- URL: `http://localhost:5050`
- Email: El que definiste en `.env` (por defecto: `admin@infra.local`)
- Password: El que definiste en `.env`

La conexión al servidor TimescaleDB ya está pre-configurada en `pgadmin-servers.json`.

---

## 📂 Estructura

```
infra-db/
├── .env.example              → Plantilla de variables de entorno
├── docker-compose.yml        → Definición de servicios Docker
├── pgadmin-servers.json      → Auto-registro del servidor en pgAdmin
├── init-db/
│   └── 01-init-schema.sql    → Script SQL ejecutado al crear la BD por primera vez
└── migrations/                → Migraciones SQL incrementales (`YYYY-MM-DD-nombre.sql`),
                                  aplicadas por `scripts/deploy-production.sh` en cada
                                  deploy — ver docs/deployment.md
```

---

## 🗃️ Esquema de Base de Datos

El script `init-db/01-init-schema.sql` crea automáticamente estas tablas (lista no
exhaustiva; las migraciones en `migrations/` agregan más desde entonces — este
archivo se queda desactualizado a propósito y **no** se corrige con cada migración):

| Tabla                         | Descripción                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `empresa`                     | Empresas principales (ej: "PepsiCo Internacional")                                    |
| `sub_empresa`                 | Sucursales/faenas de cada empresa                                                     |
| `usuario`                     | Usuarios del sistema con roles, empresa asignada y hash de contraseña                 |
| `sitio`                       | Instalaciones/pozos monitoreados                                                      |
| `pozo_config`                 | Config DGA por sitio                                                                  |
| `reg_map`                     | Mapeo de variables por equipo (alias, unidad, rol)                                    |
| `alertas` / `alertas_eventos` | Reglas de alertas y sus eventos disparados                                            |
| `documentos`                  | Documentos adjuntos por sitio/empresa                                                 |
| `incidencias`                 | Incidencias operativas registradas                                                    |
| `equipo`                      | Hypertable de TimescaleDB con la telemetría cruda (`time`, `id_serial`, `data` JSONB) |

No existe una tabla `mediciones` — el nombre real del hypertable de telemetría es
`equipo`. `main-api/ARCHITECTURE.md` documenta el resto de las tablas agregadas por
migraciones posteriores (DGA, contadores, bitácora, etc.).

### Características de TimescaleDB

- `equipo` es una **Hypertable** con chunks de 1 día.
- Compresión automática activada para datos mayores a 7 días (`segmentby = id_serial`).
- Continuous aggregates (`equipo_1min`, etc.) para dashboard history y export CSV —
  ver `infra-db/migrations/2026-05-22-equipo-data-caggs.sql`.
- Optimizada para consultas de series temporales (últimas lecturas, rangos de fecha, etc.).

---

## 🛑 Notas

- Los datos se persisten en volúmenes Docker (`timescaledb_data`). Si eliminas el contenedor pero NO el volumen, los datos sobreviven.
- El script SQL de `init-db/` se ejecuta **solo la primera vez** que se crea la base de datos. Si necesitas re-ejecutarlo, elimina el volumen: `docker volume rm infra-db_timescaledb_data`.
- El puerto expuesto es `5433` (no el estándar `5432`) para evitar conflictos con instalaciones locales de PostgreSQL.
