# Emeltec Platform

Emeltec Platform es una plataforma web para monitoreo industrial, administracion de empresas, gestion de usuarios, visualizacion de instalaciones y procesamiento de datos operativos.

El proyecto esta disenado como una aplicacion multi-servicio desplegada con Docker Compose. Incluye un frontend Angular, APIs Node.js, una base de datos TimescaleDB/PostgreSQL, un pipeline gRPC y configuracion de infraestructura para operar en una VM Linux.

## Objetivo

La plataforma centraliza informacion de instalaciones industriales y entrega herramientas para operar modulos como:

- Consumo de agua.
- Cumplimiento normativo DGA (Direccion General de Aguas): declaracion de mediciones a SNIA.
- Contadores: agregacion mensual y diaria de energia y volumen.
- Generacion de riles.
- Alertas: reglas de monitoreo y notificacion por correo.
- Variables de proceso.
- Consumo electrico.
- Maletas piloto.
- Administracion de usuarios, empresas, sitios e instalaciones.

El frontend consume APIs internas mediante rutas relativas (`/api/...`). En desarrollo esas rutas se pueden resolver con el proxy de Angular o con Docker Compose. En produccion, Nginx y los contenedores de la VM enrutan el trafico hacia los servicios correspondientes.

## Arquitectura

| Capa               | Tecnologia                      | Descripcion                                                          |
| ------------------ | ------------------------------- | -------------------------------------------------------------------- |
| Frontend           | Angular                         | Interfaz web principal de la plataforma.                             |
| API principal      | Node.js + Express               | Gestion de empresas, sitios, usuarios, datos y consultas operativas. |
| Auth API           | Node.js + Express               | Autenticacion, JWT, usuarios y codigos de acceso.                    |
| Base de datos      | TimescaleDB/PostgreSQL          | Persistencia relacional y datos de telemetria.                       |
| Pipeline           | Go + gRPC                       | Procesamiento e ingestion de datos.                                  |
| Proxy/servidor web | Nginx                           | Publicacion del frontend y enrutamiento de APIs en produccion.       |
| Deploy             | Docker Compose + GitHub Actions | Construccion, reinicio y despliegue automatico en VM.                |

## Estructura del repositorio

| Ruta                | Proposito                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `frontend-angular/` | Frontend oficial Angular. Es el unico frontend usado por Docker Compose y GitHub Actions. |
| `main-api/`         | API principal de la plataforma.                                                           |
| `auth-api/`         | Servicio de autenticacion.                                                                |
| `grpc-pipeline/`    | Servicios Go/gRPC para procesamiento de datos.                                            |
| `metrics-page/`     | Pagina liviana de metricas operativas.                                                    |
| `infra-db/`         | Scripts de inicializacion y migraciones de base de datos.                                 |
| `infra-nginx/`      | Configuracion Nginx usada en la VM.                                                       |
| `scripts/`          | Scripts operativos, incluido el deploy remoto.                                            |
| `docs/`             | Documentacion tecnica del proyecto.                                                       |

## Requisitos

- Git.
- Node.js 24+ (Angular 21).
- pnpm 11+ (recomendado vía `corepack enable`).
- Docker Desktop o Docker Engine.
- Docker Compose.

## Configuracion local

Antes de levantar los servicios, crea los archivos de entorno (cada `.env.example` indica los valores requeridos):

```bash
cp .env.example .env
cp main-api/.env.example main-api/.env
cp auth-api/.env.example auth-api/.env
```

Reemplaza los placeholders `CHANGE_ME` por valores reales. Para `JWT_SECRET` e `INTERNAL_API_KEY` usa una clave fuerte (mismo valor en ambas APIs):

```bash
openssl rand -hex 32
```

Si `JWT_SECRET` o `INTERNAL_API_KEY` no estan definidas las APIs **abortan al arrancar** (fail-fast).

Los archivos `.env` reales no deben versionarse en Git.

## Instalacion (workspaces pnpm)

El repositorio usa pnpm workspaces (`pnpm-workspace.yaml`). Un solo `pnpm install` desde la raiz instala dependencias de `frontend-angular`, `main-api`, `auth-api` y `shared`:

```bash
pnpm install
```

Scripts disponibles desde la raiz:

```bash
pnpm start            # frontend + auth-api + main-api en paralelo (concurrently)
pnpm run lint         # lint en todos los workspaces
pnpm run lint:fix     # lint con autofix
pnpm run format       # prettier write
pnpm run format:check # prettier check
pnpm test             # tests de todos los workspaces
pnpm run build        # build de todos los workspaces (Angular productivo)
```

## Levantar todo en local

Desde la raiz del repositorio:

```bash
docker compose up -d --build
```

Servicios principales:

| Servicio               | URL local               |
| ---------------------- | ----------------------- |
| Frontend               | `http://localhost:5173` |
| Main API               | `http://localhost:3000` |
| Auth API               | `http://localhost:3001` |
| Metrics page           | `http://localhost:8081` |
| PostgreSQL/TimescaleDB | `localhost:5433`        |

Para revisar el estado:

```bash
docker compose ps
```

Para ver logs:

```bash
docker compose logs -f main-api
docker compose logs -f auth-api
docker compose logs -f frontend-angular
```

Para detener el ambiente:

```bash
docker compose down
```

## Desarrollo del frontend

Tambien puedes trabajar solo el frontend con el servidor de desarrollo de Angular:

```bash
pnpm --filter frontend-angular start
```

Luego abre:

```text
http://127.0.0.1:4300
```

Para probar integracion completa, las APIs necesarias deben estar levantadas y accesibles segun la configuracion del proxy del frontend.

## Validacion

Build del frontend:

```bash
pnpm --filter frontend-angular exec ng build --configuration=production
```

Validar Docker Compose desde la raiz:

```bash
docker compose config --quiet
```

## Produccion y VM

Produccion corre en una unica VM Linux con Docker Compose, publicada por Nginx en
`nuevacloud.emeltec.cl` (`cloud.emeltec.cl` es la plataforma legacy). El deploy a
`main` es automatico, sin aprobacion manual, y termina en la VM en ~3-10 minutos.

El flujo real es:

1. Push a `main` dispara `build-publish.yml`: un runner GitHub-hosted construye las
   imagenes y las publica en GHCR.
2. Si ese build termina OK, se dispara `deploy-selfhosted.yml` en el runner
   self-hosted de la VM: hace `git pull`, aplica migraciones y actualiza los
   contenedores con `docker compose pull` + `up --no-build` (no reconstruye en la VM).
3. Nginx publica el frontend y enruta las APIs bajo `nuevacloud.emeltec.cl`.

Un tercer workflow (`deploy-production.yml`) solo valida el build en cada push; su
deploy por SSH es manual (`workflow_dispatch`).

La documentacion especifica de despliegue, con el detalle de cada workflow, esta en
[`docs/deployment.md`](docs/deployment.md).

## Notas de mantenimiento

- `frontend-angular/` es el frontend oficial del proyecto.
- Los archivos `.env` reales deben mantenerse fuera del repositorio.
- Los cambios a `main` pueden ejecutar el flujo de despliegue configurado en GitHub Actions.
- Antes de mergear cambios funcionales, valida build y Docker Compose.
