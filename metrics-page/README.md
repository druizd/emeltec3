# Metrics page

Pagina estatica independiente para `metrics.emeltec.cl`.

El contenedor compila la UI JavaScript vanilla con Node 24 y sirve el build estatico por Nginx.
En runtime, Nginx reenvia `/api/*` hacia `main-api:3000`.
En `docker-compose.yml` queda publicado solo en `127.0.0.1:8081`, pensado para que
un Nginx del servidor lo exponga por `https://metrics.emeltec.cl`.

La imagen final usa `nginx:stable-alpine3.23`, compatible con despliegues Linux
actuales y sin React/Babel en runtime.

## Prueba local

```bash
docker compose up -d metrics-page
curl http://127.0.0.1:8081/health
```
