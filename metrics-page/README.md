# Metrics page

Pagina estatica independiente para `metrics.emeltec.cl`.

El contenedor sirve la pagina por Nginx y reenvia `/api/*` hacia `main-api:3000`.
En `docker-compose.yml` queda publicado solo en `127.0.0.1:8081`, pensado para que
un Nginx del servidor lo exponga por `https://metrics.emeltec.cl`.

## Prueba local

```bash
docker compose up -d metrics-page
curl http://127.0.0.1:8081/health
```
