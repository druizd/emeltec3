# nginx — 502 en `/api` tras reiniciar Docker

Runbook del 502 recurrente que deja la web caída después de `systemctl restart docker`
(o de un reinicio de la VM). Síntoma típico: la SPA carga pero toda llamada a `/api`
devuelve 502, y `docker ps` muestra `emeltec-api` **healthy**.

---

## Síntoma

- `https://nuevacloud.emeltec.cl` sirve el HTML y los assets sin problema.
- Todo `/api/**` devuelve 502.
- `docker ps` muestra `emeltec-api` y `emeltec-auth` en `(healthy)`.
- El `error.log` del nginx del **host** no tiene `connect() failed` reciente.

Esa última señal es la que distingue este caso: si el nginx del host no registra el
fallo de conexión pero igual sale 502, el 502 viene ya armado desde un upstream —
es decir, desde el nginx que corre **dentro** del container `emeltec-frontend`.

---

## Causa raíz

Dos hechos que se combinan mal.

**1. Todo `/api` pasa hoy por el container frontend.** En la VM,
`/etc/nginx/sites-enabled/emeltec-sites` tiene únicamente `location / → 127.0.0.1:5173`.
No existe ningún `location /api/`, así que la API entra por `emeltec-frontend`, que
corre su propio nginx y proxea **por nombre de Docker**
(`frontend-angular/nginx.conf:66,78` → `http://auth-api:3001` y `http://main-api:3000`)
sin directiva `resolver`. nginx resuelve los nombres de upstream **una sola vez al
arrancar** y cachea la IP para siempre.

**2. `depends_on` no aplica cuando reinicia el daemon.** En `docker-compose.yml:186-191`
el frontend declara `depends_on: main-api/auth-api condition: service_healthy`. Eso lo
honra la CLI de Compose en `docker compose up`. Cuando reinicias el daemon, los
containers los levanta el propio daemon según `restart: unless-stopped`, y el daemon no
sabe nada de `depends_on`: arrancan todos a la vez.

Resultado: `emeltec-frontend` arranca antes que `main-api`, resuelve `main-api` a una IP
que después cambia (los servicios flapean esperando a que Postgres salga de recovery), y
queda apuntando a la IP vieja de forma permanente. Por eso `docker compose up` funciona
siempre y `systemctl restart docker` rompe siempre.

Ocurrió al menos el 2026-08-17 y se ha repetido en cada reinicio del daemon desde
entonces.

---

## Diagnóstico

```bash
# 1. ¿el nginx del host ve el fallo? Si NO hay connect() failed reciente,
#    el 502 viene del container.
sudo tail -50 /var/log/nginx/error.log

# 2. el 502 real, con la IP que el frontend está intentando alcanzar
docker logs --tail 50 emeltec-frontend

# 3. cruzar esa IP contra las IPs actuales — si no calza con ninguna,
#    es este problema, confirmado
docker inspect -f '{{.Name}} {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  $(docker ps -q)
```

---

## Parche inmediato

```bash
docker restart emeltec-frontend
```

Reinicia el nginx del container, que vuelve a resolver los nombres y toma las IPs
actuales. **Importante:** hazlo _después_ de que `main-api` esté healthy, no antes, o
vuelve a cachear una IP transitoria:

```bash
docker ps --format '{{.Names}}\t{{.Status}}'   # esperar (healthy)
docker restart emeltec-frontend

curl -s -o /dev/null -w '%{http_code}\n' https://nuevacloud.emeltec.cl/api/v2/health/live
```

`nginx -s reload` dentro del container **no sirve** para este caso: recarga la config
pero no fuerza una re-resolución de los upstreams ya cacheados.

---

## Arreglo de fondo — sacar `/api` del container frontend

`infra-nginx/emeltec-sites.conf` (versionado) ya tiene `/api/ → 127.0.0.1:3000` y
`/api/auth/ → 127.0.0.1:3001` directo por loopback. Loopback no se resuelve por DNS: no
hay IP que cachear y el container frontend pasa a servir solo estáticos. Elimina la
clase de error completa.

El archivo está en el repo desde junio 2026 pero **nunca se desplegó**, y ningún workflow
lo despliega (`build-publish`, `ci`, `deploy-production`, `deploy-selfhosted` — ninguno lo
toca). Es 100% manual:

```bash
# 1. ver qué tan lejos está lo desplegado de lo versionado. REVISAR ANTES DE COPIAR:
#    lo desplegado puede tener rutas de certificado o server_name que el repo no refleje.
sudo diff -u /etc/nginx/sites-enabled/emeltec-sites infra-nginx/emeltec-sites.conf

# 2. respaldar y copiar
sudo cp /etc/nginx/sites-enabled/emeltec-sites /root/emeltec-sites.bak.$(date +%F)
sudo cp infra-nginx/emeltec-sites.conf /etc/nginx/sites-available/emeltec-sites
sudo ln -sf /etc/nginx/sites-available/emeltec-sites /etc/nginx/sites-enabled/emeltec-sites

# 3. validar ANTES de recargar
sudo nginx -t && sudo systemctl reload nginx

# 4. verificar
curl -s -o /dev/null -w '%{http_code}\n' https://nuevacloud.emeltec.cl/api/v2/health/live
```

Prueba real del arreglo: después de esto, `systemctl restart docker` debe dejar el sitio
funcionando sin tocar nada.

> El hallazgo de auditoría **EMT-M03** apunta a este mismo archivo por faltarle
> `server_tokens off`, HSTS, TLS endurecido y `limit_req` en `/api/auth`. El archivo del
> repo todavía no los tiene: desplegarlo arregla los 502 pero deja EMT-M03 abierto.
> Ver `docs/security-audit/INFORME-AUDITORIA-SEGURIDAD-2026-06.md:379`.

---

## Alternativas (peores, documentadas para no volver a evaluarlas)

**`resolver` en el nginx del container.** Agregar `resolver 127.0.0.11 valid=10s;` y pasar
el upstream por variable. Funciona en este caso concreto porque los paths de origen y
destino son idénticos (`location /api/` → `proxy_pass .../api/`), así que `$request_uri`
reconstruye exactamente lo mismo:

```nginx
resolver 127.0.0.11 valid=10s;

location /api/ {
    set $main_api http://main-api:3000;
    proxy_pass $main_api$request_uri;   # $request_uri ya incluye la query string
}
```

Ventaja: se despliega solo al pushear a main, sin entrar a la VM. Desventaja: sigues
pagando el salto extra por el container y dependiendo del DNS de Docker. **Cuidado
general:** nginx no acepta parte de URI en `proxy_pass` cuando hay variables — si algún
día los paths dejan de coincidir, hay que reconstruir las rutas a mano.

**Unidad systemd que reinicia el frontend tras Docker.** No arregla nada, solo automatiza
el `docker restart`. Sirve como red de seguridad mientras no se despliegue el arreglo de
fondo:

```ini
# /etc/systemd/system/emeltec-frontend-refresh.service
[Unit]
Description=Refresca emeltec-frontend tras arrancar Docker
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStartPre=/bin/sleep 60
ExecStart=/usr/bin/docker restart emeltec-frontend

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable emeltec-frontend-refresh
```

---

## Archivos relacionados

| Ruta                                | Rol                                                                   |
| ----------------------------------- | --------------------------------------------------------------------- |
| `infra-nginx/emeltec-sites.conf`    | Config del nginx de borde (VM). Correcta, sin desplegar.              |
| `frontend-angular/nginx.conf:66,78` | `proxy_pass` por nombre de Docker, sin `resolver`. Origen del cacheo. |
| `docker-compose.yml:186-191`        | `depends_on` del frontend — solo aplica en `compose up`.              |
