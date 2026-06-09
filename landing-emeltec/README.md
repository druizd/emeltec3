# Landing Emeltec

Landing estática para Emeltec Cloud, enfocada en monitoreo IIoT, operación industrial y
cumplimiento DGA.

## Archivos

- `index.html`: página completa.
- `styles.css`: estilos responsive.
- `script.js`: envío de formulario vía `mailto:ventas@emeltec.cl`.
- `assets/`: logo, imágenes y fuente Josefin Sans usada por la landing.

## Probar local

Abrir `index.html` en el navegador.

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
