# Emeltec Platform

Plataforma Emeltec para monitoreo industrial, administracion de empresas, autenticacion, APIs de telemetria e infraestructura de despliegue.

## Estructura del repo

| Ruta | Proposito |
|---|---|
| `frontend-angular/` | Frontend oficial Angular. Es el unico frontend usado por Docker Compose y GitHub Actions. |
| `main-api/` | API principal Node.js/Express: empresas, sitios, usuarios, datos, metricas y alertas. |
| `auth-api/` | API de autenticacion y codigos de acceso. |
| `grpc-pipeline/` | Pipeline Go/gRPC para procesamiento e ingestion. |
| `metrics-page/` | Pagina liviana de metricas operativas. |
| `infra-db/` | Inicializacion y migraciones de base de datos. |
| `infra-nginx/` | Configuracion de Nginx externo para la VM. |
| `scripts/` | Scripts operativos, incluido el deploy remoto. |
| `docs/` | Documentacion del proyecto y despliegue. |

## Desarrollo frontend

Frontend local con backend local:

```bash
cd frontend-angular
npm install
npm start
```

Frontend local usando el backend de produccion en la VM:

```bash
cd frontend-angular
npm install
npm run start:production-api
```

Luego abre:

```text
http://127.0.0.1:4300
```

## Validacion rapida

```bash
cd frontend-angular
npm run build -- --configuration=production
```

Desde la raiz del repo:

```bash
docker compose config --quiet
```

## Deploy

El deploy de produccion se ejecuta automaticamente con GitHub Actions al hacer push o merge a `main`.

Documentacion:

```text
docs/deployment.md
```

El flujo actual construye y reinicia los servicios definidos en `docker-compose.yml`.
