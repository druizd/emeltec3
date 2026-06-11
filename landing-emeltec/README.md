# Landing Emeltec

Landing estática para Emeltec Cloud, enfocada en monitoreo IIoT, operación industrial,
cumplimiento DGA, HACCP e ISO 22000.

## Archivos

- `index.html`: página completa.
- `styles.css`: estilos responsive.
- `script.js`: menú móvil, carrusel de testimonios y apertura de Gmail con correo prellenado.
- `serve-local.js`: servidor estático local.
- `assets/`: logo, imágenes y fuente Josefin Sans usada por la landing.

## SEO / medición

Google Analytics y Google Search Console no quedan conectados hasta tener credenciales reales.

Para conectar:

- Google Analytics: crear una propiedad GA4 y reemplazar `G-XXXXXXXXXX` en `index.html` por el
  Measurement ID real.
- Google Search Console: agregar la propiedad del dominio, elegir verificación por etiqueta HTML y
  reemplazar `TOKEN_SEARCH_CONSOLE` en `index.html` por el token entregado.
- Después de subir a la VM, verificar en Search Console y revisar eventos en Analytics en tiempo real.

## Probar local

Para ver solo la página, puedes abrir `index.html` en el navegador.

Para probar el flujo de Gmail:

```powershell
# Desde la raíz del repo
node landing-emeltec\serve-local.js
```

Abrir `http://localhost:8080/`. El formulario abre Gmail con los datos ingresados y destino `ventas@emeltec.cl`.

## Formulario de contacto

El formulario no expone credenciales ni usa backend. Al enviar, abre Gmail Compose con destino
`ventas@emeltec.cl`, asunto y cuerpo prellenados con nombre, correo, empresa, teléfono, servicio y
mensaje. El usuario debe presionar **Enviar** dentro de Gmail.

## Docker con dominio propio

La landing tiene su propio servicio en `docker-compose.yml`, separado de `metrics-page`.
Queda publicada solo en localhost del servidor:

```bash
docker compose up -d landing-emeltec
curl http://127.0.0.1:8082/health
```

`metrics.emeltec.cl` puede seguir apuntando a `127.0.0.1:8081`.
El dominio nuevo de la landing debe apuntar a `127.0.0.1:8082`.

Ejemplo de server block para la VM:

```nginx
server {
    listen 443 ssl http2;
    server_name landing.emeltec.cl;

    ssl_certificate /etc/letsencrypt/live/landing.emeltec.cl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/landing.emeltec.cl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Subir a Nginx

```bash
sudo mkdir -p /var/www/landing-emeltec
sudo rsync -av landing-emeltec/ /var/www/landing-emeltec/
sudo chown -R www-data:www-data /var/www/landing-emeltec
```

Ejemplo de server block:

```nginx
server {
    listen 80;
    server_name landing.emeltec.cl;

    root /var/www/landing-emeltec;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(png|jpg|jpeg|webp|svg|css|js)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Activar:

```bash
sudo ln -s /etc/nginx/sites-available/landing-emeltec /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```
