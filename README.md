# Plataforma de Monitoreo Industrial - Emeltec

Plataforma web para monitoreo de telemetria industrial, autenticacion por roles, gestion de usuarios, alertas, metricas de uso y procesamiento de datos por gRPC.

## Arquitectura General

El proyecto esta organizado por servicios independientes:

```text
emeltec-platform/
+-- infra-db/          Base de datos TimescaleDB/PostgreSQL
+-- auth-api/          Servicio de autenticacion, login y codigos OTP
+-- main-api/          API principal de negocio, datos, usuarios, empresas, metricas y alertas
+-- frontend-angular/  Frontend web Angular servido por Nginx
+-- metrics-page/      Pagina estatica para metrics.emeltec.cl
+-- grpc-pipeline/     Pipeline Go para procesar CSV y enviar datos por gRPC
\-- infra-nginx/       Ejemplo de configuracion Nginx para la VM
```

Flujo principal:

```text
Navegador
  |
  | HTTPS
  v
Nginx externo / frontend-angular
  |-- /api/auth/*  -> auth-api:3001
  |-- /api/*       -> main-api:3000
  |-- metrics.*    -> metrics-page:8081

main-api  -> TimescaleDB
main-api  -> csvconsumer gRPC
main-api  -> Resend para correos
```

## Servicios

| Servicio | Puerto local | Descripcion |
|---|---:|---|
| `timescaledb` | `5433` | Base de datos TimescaleDB/PostgreSQL |
| `main-api` | `3000` | API principal de datos, empresas, usuarios, alertas y metricas |
| `auth-api` | `3001` | Login, JWT y generacion de codigos OTP |
| `frontend-angular` | `5173` | Frontend Angular compilado y servido por Nginx |
| `metrics-page` | `127.0.0.1:8081` | Pagina estatica para metricas |
| `csvconsumer` | `50051` | Servicio gRPC para ingesta de datos |

## Puesta en Marcha Rapida

### Requisitos

- Git
- Docker Desktop o Docker Engine
- Node.js LTS para desarrollo local, recomendado Node 20 o 22

### Clonar el repositorio

```bash
git clone https://github.com/Nicolas182003/emeltec-platform.git
cd emeltec-platform
```

### Levantar con Docker Compose

```bash
docker compose up -d --build
```

El frontend principal queda disponible en:

```text
http://localhost:5173
```

La API principal queda disponible en:

```text
http://localhost:3000
```

El servicio de autenticacion queda disponible en:

```text
http://localhost:3001
```

La pagina de metricas queda disponible localmente en:

```text
http://127.0.0.1:8081
```

## Desarrollo Local

### main-api

```bash
cd main-api
npm install
npm test
npm start
```

### auth-api

```bash
cd auth-api
npm install
cp .env.example .env
npm start
```

### frontend-angular

```bash
cd frontend-angular
npm install
npm start
```

En desarrollo Angular usa `proxy.conf.json`. En Docker, Nginx enruta `/api/auth/` hacia `auth-api` y el resto de `/api/` hacia `main-api`.

## Variables de Entorno

No subas archivos `.env` reales al repositorio.

Variables importantes para `main-api`:

```env
DB_HOST=timescaledb
DB_PORT=5432
DB_NAME=telemetry_platform
DB_USER=postgres
DB_PASSWORD=admin_password
JWT_SECRET=super_secret_dev_key_12345
RESEND_API_KEY=
RESEND_FROM=Emeltec - Panel Industrial <noreply@emeltec.cl>
FRONTEND_URL=https://nuevacloud.emeltec.cl/login
INTERNAL_API_KEY=
```

Variables importantes para `auth-api`:

```env
PORT=3001
JWT_SECRET=super_secret_dev_key_12345
MAIN_API_URL=http://main-api:3000
INTERNAL_API_KEY=
DB_HOST=timescaledb
DB_PORT=5432
DB_NAME=telemetry_platform
DB_USER=postgres
DB_PASSWORD=admin_password
```

`INTERNAL_API_KEY` debe coincidir entre `auth-api` y `main-api` cuando se use en produccion.

## Autenticacion y Usuarios

El flujo actual separa responsabilidades:

1. `frontend-angular` solicita `/api/auth/request-code`.
2. Nginx envia esa ruta a `auth-api`.
3. `auth-api` valida el correo, genera un codigo OTP alfanumerico y lo guarda hasheado.
4. `auth-api` pide a `main-api` enviar el correo por endpoint interno.
5. `main-api` envía el correo usando Resend o simula el envío si no hay `RESEND_API_KEY`.
6. El usuario inicia sesion en `/api/auth/login` y recibe JWT.
7. El frontend usa ese JWT para llamar endpoints protegidos de `main-api`.

Roles principales:

| Rol | Acceso |
|---|---|
| `SuperAdmin` | Acceso global a empresas, divisiones y usuarios |
| `Admin` | Gestión dentro de su empresa |
| `Gerente` | Gestión limitada a su división |
| `Cliente` | Acceso de solo lectura |

## Base de Datos

La tabla principal de telemetria es `equipo`. Los tests del backend estan alineados con esa tabla.

Para crear usuarios iniciales en desarrollo:

```bash
cd main-api
node src/seed_auth.js
```

Credenciales de desarrollo creadas por el seed:

```text
superadmin@gmail.com : 1234
admin@gmail.com      : 1234
cliente@gmail.com    : 1234
```

## Dominios y Nginx

`infra-nginx/emeltec-sites.conf` contiene un ejemplo para exponer:

- `https://nuevacloud.emeltec.cl` -> frontend principal
- `https://metrics.emeltec.cl` -> pagina de metricas

`metrics-page` se publica en `127.0.0.1:8081` para que solo el Nginx externo de la VM lo exponga.

## Comandos Utiles

```bash
# Ver estado de servicios
docker compose ps

# Reconstruir servicios principales
docker compose up -d --build main-api auth-api frontend-angular metrics-page

# Logs de API principal
docker compose logs -f main-api

# Logs de autenticacion
docker compose logs -f auth-api

# Logs del frontend
docker compose logs -f frontend-angular
```

## Verificación Antes de Subir Cambios

```bash
cd main-api
npm test

cd ../frontend-angular
npm run build

cd ..
docker compose config --quiet
```

## Seguridad

- No subir `.env` reales.
- Cambiar `JWT_SECRET` en produccion.
- Configurar `INTERNAL_API_KEY` en produccion.
- Configurar `RESEND_API_KEY` y `RESEND_FROM` para correos reales.
- Mantener la base de datos fuera de acceso publico directo.

## Stack Tecnologico

| Capa | Tecnologia |
|---|---|
| Frontend | Angular 21 + TailwindCSS |
| Frontend server | Nginx |
| Backend principal | Node.js + Express |
| Auth | Node.js + Express + JWT + bcrypt |
| Base de datos | TimescaleDB/PostgreSQL |
| Correos | Resend |
| Pipeline | Go + gRPC |
| Contenedores | Docker Compose |