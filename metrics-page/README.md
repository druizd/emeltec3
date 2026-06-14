# Metrics page

Pagina estatica independiente para `metrics.emeltec.cl`.

El contenedor compila la UI JavaScript vanilla con Node 24 y sirve el build estatico por Nginx.
En runtime, Nginx reenvia `/api/*` hacia `main-api:3000` y `/api/auth/*` hacia `auth-api:3001`.
En `docker-compose.yml` queda publicado solo en `127.0.0.1:8081`, pensado para que
un Nginx del servidor lo exponga por `https://metrics.emeltec.cl`.

La imagen final usa `nginx:stable-alpine3.23`, compatible con despliegues Linux
actuales y sin React/Babel en runtime.

## Vistas

La pagina tiene dos niveles, alineados con la separacion de seguridad del backend:

- **Publica (anonima):** consume `GET /api/status`, que es publico y **minimo**
  (solo el estado por servicio, sin detalle interno — hallazgo EMT-C03/M08).
  Muestra el semaforo global y el estado de cada servicio.
- **Operativa (autenticada):** tras iniciar sesion (correo + contrasena, con
  paso OTP/MFA si la cuenta lo exige), consume
  `GET /api/status/detail` con un token Bearer. Ese endpoint exige rol
  `SuperAdmin` o `Admin` y entrega latencia, uptime, entorno, version y el
  inventario sondeado en vivo, ademas de graficos (latencia historica, anillo
  de disponibilidad) y el contexto de arquitectura.

El token se guarda en `localStorage`. Un `401` cierra la sesion; un `403`
(rol sin permiso) cae a la vista publica con un aviso.

## Prueba local

```bash
docker compose up -d metrics-page
curl http://127.0.0.1:8081/health
```

Para probar el detalle autenticado necesitas `main-api` y `auth-api` arriba y
una cuenta con rol `SuperAdmin`/`Admin`.
