# Frontend Angular

Frontend oficial de la plataforma Emeltec.

## Comandos

Instalar dependencias:

```bash
npm install
```

Levantar contra backend local:

```bash
npm start
```

Levantar contra backend de produccion en la VM:

```bash
npm run start:production-api
```

Build de produccion:

```bash
npm run build -- --configuration=production
```

## Proxies

| Archivo | Uso |
|---|---|
| `proxy.conf.json` | Desarrollo local con servicios locales. |
| `proxy.production.conf.json` | Desarrollo local consumiendo `https://nuevacloud.emeltec.cl`. |

La aplicacion usa rutas relativas (`/api/...`), por lo que el proxy de Angular decide si las llamadas van a servicios locales o a la VM.
