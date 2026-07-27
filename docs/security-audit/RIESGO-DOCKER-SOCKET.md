# Riesgo: Docker socket montado en main-api

**Fecha:** 2026-07-22  
**Severidad:** Media (mitigada)  
**Estado:** Aceptado conscientemente — documentado para revisión futura

---

## Qué se hizo

Se montó `/var/run/docker.sock` en el contenedor `emeltec-api` (main-api) para exponer el endpoint `/api/docker/events`, que permite a los administradores ver el historial de eventos Docker (starts, stops, crashes, kills) de las últimas 24 horas desde el panel de métricas.

```yaml
# docker-compose.yml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

**Archivos involucrados:**
- `main-api/src/controllers/dockerController.js` — lee eventos del daemon Docker via dockerode
- `main-api/src/routes/dockerRoutes.js` — GET `/api/docker/events`, requiere auth
- `main-api/src/app.js` — monta las rutas en `/api/docker`
- `metrics-page/src/main.js` — panel Docker Events en el dashboard de métricas

---

## El problema

### `:ro` no restringe la API de Docker

El mount `read-only` afecta únicamente las operaciones de escritura a nivel de **filesystem** sobre el socket. Sin embargo, el protocolo del socket Docker es un canal bidireccional HTTP/Unix — las operaciones de escritura de la API (crear contenedores, eliminar imágenes, ejecutar comandos, etc.) pasan igual a través de un socket montado `:ro`.

En la práctica: `main-api` tiene acceso completo al daemon Docker, no solo lectura.

### Superficie de ataque

Si un atacante consigue ejecutar código arbitrario dentro del contenedor `emeltec-api` (RCE), puede:

1. Listar y acceder a todos los contenedores del host
2. Ejecutar comandos dentro de otros contenedores (`docker exec`)
3. Montar volúmenes del host y leer archivos fuera del contenedor
4. Escalar a root del host montando `/` del filesystem

Esto convierte una vulnerabilidad en main-api en un compromiso total del servidor Linux.

---

## Mitigaciones en lugar

| Mitigación | Detalle |
|-----------|---------|
| Auth obligatoria | El endpoint requiere token JWT válido + rol `SuperAdmin` o `Admin` |
| Red interna | El endpoint no está expuesto directamente al exterior, pasa por el proxy |
| Cache 60s | El controlador cachea la respuesta — limita las llamadas reales al daemon |
| Sin operaciones de escritura | El código solo llama a `docker.getEvents()` — no crea ni modifica contenedores |

---

## Cómo eliminarlo si se decide revertir

1. Eliminar la línea del socket en `docker-compose.yml`:
   ```yaml
   # Borrar esta línea:
   - /var/run/docker.sock:/var/run/docker.sock:ro
   ```

2. Eliminar los archivos del backend:
   ```
   main-api/src/controllers/dockerController.js
   main-api/src/routes/dockerRoutes.js
   ```

3. Remover el import y mount en `main-api/src/app.js`:
   ```js
   // Borrar:
   const dockerRoutes = require('./routes/dockerRoutes');
   app.use('/api/docker', dockerRoutes);
   ```

4. Desinstalar dependencia:
   ```bash
   cd main-api && pnpm remove dockerode
   ```

5. Eliminar el panel del frontend en `metrics-page/src/main.js`:
   - Función `dockerPanel()`
   - El fetch a `/api/docker/events` dentro de `poll()`
   - Las keys `dockerEvents` y `dockerError` del estado
   - La llamada a `dockerPanel()` en el template

---

## Alternativas más seguras para el futuro

- **Leer logs de Docker por archivo** — montar `/var/log/` del host `:ro` y parsear `docker` logs desde ahí. Limitado pero sin acceso al daemon.
- **Sidecar dedicado** — contenedor separado con el socket, expone solo un endpoint HTTP de solo lectura con permisos mínimos. main-api llama al sidecar, nunca al daemon directamente.
- **Portainer/Dozzle** — herramientas dedicadas para visualización de Docker, ya diseñadas con este problema en mente.
