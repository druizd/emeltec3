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
└── init-db/
    └── 01-init-schema.sql    → Script SQL ejecutado al crear la BD por primera vez
```

---

## 🗃️ Esquema de Base de Datos

El script `init-db/01-init-schema.sql` crea automáticamente las siguientes tablas:

| Tabla         | Descripción                                                           |
| ------------- | --------------------------------------------------------------------- |
| `empresa`     | Empresas principales (ej: "PepsiCo Internacional")                    |
| `sub_empresa` | Sucursales/faenas de cada empresa                                     |
| `usuario`     | Usuarios del sistema con roles, empresa asignada y hash de contraseña |
| `equipo`      | Equipos de medición registrados                                       |
| `mediciones`  | Hypertable de TimescaleDB para datos de telemetría en tiempo real     |

### Características de TimescaleDB

- La tabla `mediciones` es una **Hypertable** con chunks de 1 día.
- Compresión automática activada para datos mayores a 7 días.
- Optimizada para consultas de series temporales (últimas lecturas, rangos de fecha, etc.).

---

## 🛑 Notas

- Los datos se persisten en volúmenes Docker (`timescaledb_data`). Si eliminas el contenedor pero NO el volumen, los datos sobreviven.
- El script SQL de `init-db/` se ejecuta **solo la primera vez** que se crea la base de datos. Si necesitas re-ejecutarlo, elimina el volumen: `docker volume rm infra-db_timescaledb_data`.
- El puerto expuesto es `5433` (no el estándar `5432`) para evitar conflictos con instalaciones locales de PostgreSQL.
