# Frontend Angular

Frontend oficial de Emeltec Platform.

Esta aplicacion entrega la interfaz web para monitoreo industrial, navegacion por empresas e instalaciones, dashboards operativos y modulos administrativos. El frontend se comunica con las APIs mediante rutas relativas (`/api/...`) para que el mismo codigo pueda funcionar en desarrollo y en produccion.

## Tecnologia

- Angular 21.
- TypeScript.
- Tailwind CSS.
- Chart.js.
- Lucide Angular.

## Requisitos

- Node.js compatible con Angular 21.
- npm.
- APIs disponibles si se quiere probar integracion completa.

## Instalacion

Desde esta carpeta:

```bash
npm install
```

## Desarrollo local

Levanta el servidor de desarrollo por defecto con el script del proyecto:

```bash
npm start
```

Abre:

```text
http://localhost:4200
```

### Configuraciones de proxy

`npm start` usa la configuracion `development`, que aplica `proxy.conf.json`:
`/api/auth` va a `localhost:3001` (auth-api local) y el resto de `/api` a
produccion. Es el modo recomendado para trabajar el login sin tocar la API real.

| Script                         | Proxy                        | Destino de `/api`                           |
| ------------------------------ | ---------------------------- | ------------------------------------------- |
| `npm start`                    | `proxy.conf.json`            | auth local (3001), resto produccion         |
| `npm run start:local`          | `proxy.conf.local.json`      | todo local (3000 main, 3001 auth, 3002 dga) |
| `npm run start:production-api` | `proxy.production.conf.json` | **todo produccion**, en `127.0.0.1:4300`    |

> `start:production-api` pega contra `nuevacloud.emeltec.cl`: cada request queda
> en el `audit_log` de produccion y avanzar un flujo de login puede disparar
> correos OTP reales. Era el default y por eso dejo de serlo.

Para probar login, empresas, usuarios o datos reales del sistema, las APIs
correspondientes deben estar ejecutandose y accesibles.

## Build

Build de produccion:

```bash
npm run build -- --configuration=production
```

La salida se genera en:

```text
dist/frontend-angular
```

En el despliegue real, este build se ejecuta dentro de Docker mediante el `Dockerfile` del frontend y luego se sirve con Nginx.

## Estructura principal

| Ruta                    | Proposito                                                |
| ----------------------- | -------------------------------------------------------- |
| `src/app/components/`   | Componentes reutilizables de layout, UI y visualizacion. |
| `src/app/pages/`        | Paginas principales de la aplicacion.                    |
| `src/app/services/`     | Servicios Angular para comunicacion con APIs.            |
| `src/app/guards/`       | Protecciones de rutas.                                   |
| `src/app/interceptors/` | Interceptores HTTP.                                      |
| `src/styles.css`        | Estilos globales.                                        |

## Integracion con APIs

El frontend debe priorizar rutas relativas en lugar de URLs absolutas dentro del codigo:

```text
/api/auth/login
/api/companies
/api/users
```

Esto permite que:

- En desarrollo, el proxy de Angular resuelva las llamadas segun el ambiente configurado.
- En produccion, Nginx y Docker enruten el trafico hacia los servicios correctos.

## Validacion antes de subir cambios

Antes de abrir un PR o hacer merge, ejecuta:

```bash
npm run build -- --configuration=production
```

Si el cambio toca integracion con APIs, valida tambien el flujo completo levantando el proyecto desde la raiz con Docker Compose.
