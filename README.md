# ðŸ­ Plataforma de Monitoreo Industrial â€” Emeltec

Plataforma web para monitoreo de telemetrÃ­a industrial en tiempo real con autenticaciÃ³n por roles, gestiÃ³n de usuarios y envÃ­o de cÃ³digos de acceso por correo electrÃ³nico.

---

## ðŸ“ Arquitectura General

El proyecto estÃ¡ dividido en **4 carpetas independientes**, cada una con su responsabilidad:

```
ðŸ“¦ raÃ­z del proyecto
â”œâ”€â”€ ðŸ“ infra-db/          â†’ Base de datos (Docker + TimescaleDB + pgAdmin)
â”œâ”€â”€ ðŸ“ main-api/          â†’ Backend REST API (Node.js + Express)
â”œâ”€â”€ ðŸ“ frontend-angular/      â†’ Frontend Web (Angular + TailwindCSS)
â””â”€â”€ ðŸ“ grpc-pipeline/     â†’ Pipeline de datos CSV via gRPC (Go)
```

### Â¿CÃ³mo se conectan?

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  frontend-angular   â”‚â”€â”€â”€â”€â”€â–¶â”‚   main-api   â”‚â”€â”€â”€â”€â”€â–¶â”‚    infra-db      â”‚
â”‚  (Angular/Nginx)   â”‚ HTTP â”‚  (Express)   â”‚  SQL â”‚  (TimescaleDB)   â”‚
â”‚  Puerto: 5173   â”‚ /api â”‚  Puerto: 3000â”‚      â”‚  Puerto: 5433    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                â”‚
                         â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”
                         â”‚  Gmail SMTP  â”‚
                         â”‚  (Nodemailer)â”‚
                         â”‚  Puerto: 465 â”‚
                         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- **Frontend â†’ Backend:** El frontend Angular tiene un proxy configurado que redirige todas las rutas `/api/*` al backend en `localhost:3000`.
- **Backend â†’ Base de Datos:** El backend se conecta a TimescaleDB (PostgreSQL) usando las credenciales del archivo `.env`.
- **Backend â†’ Gmail:** Cuando un usuario solicita un cÃ³digo de acceso, el backend genera un codigo alfanumerico de 6 caracteres y lo envÃ­a por correo usando Nodemailer + Gmail SMTP.

---

## ðŸš€ GuÃ­a de InstalaciÃ³n RÃ¡pida (Nuevo PC)

### Requisitos Previos
| Herramienta | VersiÃ³n MÃ­nima | Descarga |
|---|---|---|
| **Node.js** | v18+ | [nodejs.org](https://nodejs.org) |
| **Docker Desktop** | Cualquiera | [docker.com](https://www.docker.com/products/docker-desktop) |
| **Git** | Cualquiera | [git-scm.com](https://git-scm.com) |

### Paso 1 â€” Clonar el Repositorio
```bash
git clone https://github.com/Nicolas182003/emeltec-platform.git
cd emeltec-platform
```

### Paso 2 â€” Levantar la Base de Datos (Docker)
```bash
cd infra-db

# Copiar las variables de entorno de ejemplo
cp .env.example .env
# âš ï¸ Edita el archivo .env con tus contraseÃ±as reales

# Levantar los contenedores
docker compose up -d

# Verificar que estÃ© corriendo
docker ps
```
Esto levanta **TimescaleDB** en el puerto `5433` y **pgAdmin** en `http://localhost:5050`.

### Paso 3 â€” Configurar y Arrancar el Backend
```bash
cd ../main-api

# Instalar dependencias
npm install

# Copiar las variables de entorno de ejemplo
cp .env.example .env
# âš ï¸ Edita el archivo .env con tus credenciales de BD y Gmail

# Sembrar usuarios iniciales de prueba (solo la primera vez)
node src/seed_auth.js

# Iniciar el servidor
npm start
```
El backend quedarÃ¡ corriendo en `http://localhost:3000`.

### Paso 4 â€” Configurar y Arrancar el Frontend
```bash
cd ../frontend-angular

# Instalar dependencias
npm install

# Iniciar el servidor de desarrollo
npm start
```
El frontend quedarÃ¡ corriendo en `http://localhost:5173`.

### Paso 5 â€” Â¡Listo! Abrir el Navegador
Abre tu navegador y ve a: **http://localhost:5173**

---

## ðŸ” Sistema de AutenticaciÃ³n (Flujo OTP)

El sistema utiliza un flujo de **cÃ³digo temporal por correo** (One-Time Password):

1. **Un Admin/SuperAdmin** registra al nuevo usuario desde el panel de "GestiÃ³n de Usuarios" (solo correo, nombre, rol y empresa).
2. **El usuario nuevo** va a la pantalla de Login y escribe su correo.
3. Hace clic en **"Recibir CÃ³digo por Correo"**.
4. El backend valida que el correo exista en la BD, genera un codigo alfanumerico de 6 caracteres, lo hashea con **bcrypt** y lo envÃ­a por Gmail.
5. El usuario ingresa el cÃ³digo y entra al Dashboard con su rol asignado.

> âš ï¸ Si el correo NO fue previamente registrado por un administrador, el sistema rechaza la solicitud. Esta es la capa de seguridad principal.

### ðŸ”‘ Primer inicio de sesiÃ³n (despuÃ©s del seed)
El script `seed_auth.js` crea 3 usuarios de prueba con la contraseÃ±a `1234`. Para entrar por primera vez:
1. En la pantalla de Login, haz clic en **"Ya tengo un cÃ³digo"**.
2. Ingresa el correo `superadmin@gmail.com` y en el campo de cÃ³digo escribe `1234`.
3. Una vez dentro, podrÃ¡s crear nuevos usuarios desde "GestiÃ³n de Usuarios".

---

## ðŸ“§ ConfiguraciÃ³n de Correos (Gmail SMTP) â€” MUY IMPORTANTE

Para que el sistema pueda enviar cÃ³digos de acceso reales al correo de los usuarios, el backend necesita conectarse a una cuenta de Gmail que actÃºa como "cartero oficial" del sistema.

### Â¿CÃ³mo funciona?
El proyecto usa **Nodemailer** para enviar correos a travÃ©s de los servidores de Google (SMTP). Solo se necesita configurar **UNA cuenta de Gmail remitente** y desde ahÃ­ se pueden enviar cÃ³digos a **cualquier correo** del mundo (Gmail, Hotmail, Yahoo, corporativo, etc.).

### ConfiguraciÃ³n
En el archivo `main-api/.env` debes configurar estas 4 variables:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=emeltecacceso@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
```

> ðŸ”’ **Las credenciales de la cuenta `emeltecacceso@gmail.com` se comparten de forma privada entre el equipo.** SolicÃ­talas al administrador del proyecto.

### Â¿CÃ³mo se obtiene el SMTP_PASS?
No es la contraseÃ±a normal de Gmail. Es una **"ContraseÃ±a de AplicaciÃ³n"** que Google genera exclusivamente para aplicaciones externas:
1. Ingresar a la cuenta de Gmail del proyecto.
2. Ir a [Seguridad de la cuenta](https://myaccount.google.com/security) â†’ Activar **VerificaciÃ³n en 2 pasos**.
3. Ir a [ContraseÃ±as de Aplicaciones](https://myaccount.google.com/apppasswords).
4. Crear una app (ej: "Panel Industrial") â†’ Google genera 16 letras â†’ Eso es el `SMTP_PASS`.

### Â¿QuÃ© pasa si NO configuro el correo?
Si las variables SMTP no estÃ¡n en el `.env`, el sistema **NO fallarÃ¡**. EntrarÃ¡ automÃ¡ticamente en **modo simulaciÃ³n (Ethereal)**:
- Los correos NO llegarÃ¡n a bandejas reales.
- En la consola del backend (terminal de Node.js) aparecerÃ¡ un **link azul** donde puedes ver el correo simulado en tu navegador.
- Ãštil para desarrollo local sin gastar envÃ­os reales.

---

## ðŸ‘¥ Roles y Permisos

| Rol | QuiÃ©n lo crea | Acceso |
|---|---|---|
| **SuperAdmin** | Solo por base de datos | Todo el sistema. Crea Admins, Gerentes y Clientes en cualquier empresa. |
| **Admin** | SuperAdmin | DueÃ±o de una empresa padre. Crea Gerentes y Clientes dentro de su empresa. |
| **Gerente** | Admin o SuperAdmin | Supervisa una sub-empresa/faena especÃ­fica. |
| **Cliente** | Admin, Gerente o SuperAdmin | Solo lectura. Visualiza el dashboard de telemetrÃ­a. |

---

## ðŸ“ Detalles por Carpeta

Cada carpeta contiene su propio `README.md` con instrucciones especÃ­ficas:

- ðŸ“‚ [`infra-db/README.md`](./infra-db/README.md) â€” Docker, TimescaleDB, esquema SQL
- ðŸ“‚ [`main-api/README.md`](./main-api/README.md) â€” Express, JWT, Nodemailer, controladores
- ðŸ“‚ [`frontend-angular/README.md`](./frontend-angular/README.md) â€” Angular, componentes, rutas protegidas
- ðŸ“‚ [`grpc-pipeline/README.md`](./grpc-pipeline/README.md) â€” Pipeline Go para procesar CSV

---

## ðŸ›‘ Notas Importantes de Seguridad

- **NUNCA** subas archivos `.env` a GitHub. Contienen contraseÃ±as reales.
- Los archivos `.env.example` son las plantillas seguras que sÃ­ se suben.
- La contraseÃ±a de Gmail (App Password) debe generarse desde: https://myaccount.google.com/apppasswords
- El `JWT_SECRET` debe cambiarse en producciÃ³n (actualmente es un valor por defecto en desarrollo).

---

## ðŸ› ï¸ Stack TecnolÃ³gico

| Capa | TecnologÃ­a |
|---|---|
| Base de Datos | TimescaleDB (PostgreSQL 16) |
| Backend | Node.js + Express 5 |
| Frontend | Angular 21 + TailwindCSS 4 |
| AutenticaciÃ³n | JWT + bcrypt + OTP |
| Correos | Nodemailer + Gmail SMTP |
| Pipeline de Datos | Go + gRPC |
| Contenedores | Docker Compose |
