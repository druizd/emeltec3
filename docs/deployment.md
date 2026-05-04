# Deploy production

Este repo puede desplegarse automaticamente a la VM de Azure cuando haces push a `main`.

## Flujo recomendado

1. Trabajas localmente y pruebas el cambio.
2. Haces commit y push a `main`.
3. GitHub Actions valida `docker-compose.yml` y construye las imagenes.
4. GitHub entra por SSH a la VM.
5. La VM hace `git pull`, reconstruye los contenedores y reinicia servicios con Docker Compose.

## Preparar la VM

En la VM, deja el repo clonado en una ruta estable:

```bash
sudo mkdir -p /opt
sudo chown "$USER:$USER" /opt
git clone https://github.com/Nicolas182003/emeltec-platform.git /opt/emeltec-platform
cd /opt/emeltec-platform
```

Crea los archivos de entorno reales solo en la VM:

```bash
cp main-api/.env.example main-api/.env
nano main-api/.env
```

Para que lleguen los codigos de acceso, `main-api/.env` debe tener valores reales para `RESEND_API_KEY`, `RESEND_FROM` y `FRONTEND_URL`. Ese mismo archivo tambien alimenta a `auth-api`, por lo que `JWT_SECRET` e `INTERNAL_API_KEY` deben quedar definidos ahi y no desalinearse entre servicios.

Prueba un deploy manual:

```bash
cd /opt/emeltec-platform
bash scripts/deploy-production.sh
```

## Secretos en GitHub Actions

En GitHub, entra a `Settings > Secrets and variables > Actions` y agrega:

| Secret | Ejemplo |
|---|---|
| `AZURE_VM_HOST` | `104.46.7.78` |
| `AZURE_VM_USER` | `azureuser` |
| `AZURE_VM_SSH_KEY` | clave privada SSH usada por GitHub Actions |
| `AZURE_VM_APP_DIR` | `/home/azureuser/emeltec-platform-actions` |

Para crear una llave dedicada:

```bash
ssh-keygen -t ed25519 -C "github-actions-emeltec" -f ~/.ssh/emeltec_github_actions
```

En la VM, agrega la llave publica a `~/.ssh/authorized_keys`.
En GitHub, guarda la llave privada completa en `AZURE_VM_SSH_KEY`.

## Usar el deploy

Cada push a `main` ejecuta `.github/workflows/deploy-production.yml`.
Tambien puedes correrlo manualmente desde la pestana `Actions` con `Run workflow`.

El script de deploy no borra la base de datos. Docker mantiene los datos en el volumen `timescale_data`.

## Cuando algo falle

Revisa el log del workflow en GitHub Actions. En la VM tambien puedes mirar:

```bash
cd /opt/emeltec-platform
docker compose ps
docker compose logs -f main-api
docker compose logs -f frontend-angular
```
