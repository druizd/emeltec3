#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/emeltec-platform}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
HEALTHCHECK_URLS="${HEALTHCHECK_URLS:-http://127.0.0.1:5173}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-emeltec-platform}"

cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "ERROR: $APP_DIR is not a git repository."
  echo "Clone the repo on the VM first, then run this deploy script again."
  exit 1
fi

if [ ! -f .env ]; then
  echo "ERROR: .env does not exist on the VM."
  echo "Create it at the repo root with all required production values."
  exit 1
fi

echo "Fetching latest code from origin/$BRANCH..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"

# Los .env del VM tienen credenciales reales — preservarlos durante el pull.
git stash --include-untracked --quiet || true
git pull --ff-only origin "$BRANCH"
git stash pop --quiet || true

echo "Validating Docker Compose configuration..."
if ! docker compose -f "$COMPOSE_FILE" config >/tmp/compose-config.out 2>/tmp/compose-config.err; then
  echo "ERROR: docker compose config failed."
  echo "--- stderr ---"
  cat /tmp/compose-config.err
  echo "--- stdout (first 80 lines) ---"
  head -80 /tmp/compose-config.out
  exit 1
fi

read_env_value() {
  local key="$1"
  if [ ! -f .env ]; then
    return 0
  fi
  { grep -E "^${key}=" .env || true; } | tail -n 1 | cut -d= -f2- | tr -d '\r'
}

MIGRATION_DB_USER="${MIGRATION_DB_USER:-$(read_env_value POSTGRES_USER)}"
MIGRATION_DB_NAME="${MIGRATION_DB_NAME:-$(read_env_value POSTGRES_DB)}"
MIGRATION_DB_USER="${MIGRATION_DB_USER:-postgres}"
MIGRATION_DB_NAME="${MIGRATION_DB_NAME:-telemetry_platform}"

echo "Starting database service before migrations..."
docker compose -f "$COMPOSE_FILE" up -d --wait timescaledb

echo "Waiting for database to accept connections..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T timescaledb \
       pg_isready -h localhost -U "$MIGRATION_DB_USER" -d "$MIGRATION_DB_NAME" >/dev/null 2>&1; then
    echo "Database ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: timescaledb did not become ready in time."
    exit 1
  fi
  sleep 2
done

if [ -d infra-db/migrations ]; then
  echo "Applying database migrations..."
  for migration in infra-db/migrations/*.sql; do
    [ -e "$migration" ] || continue
    echo "Applying $migration..."
    docker compose -f "$COMPOSE_FILE" exec -T timescaledb \
      psql -v ON_ERROR_STOP=1 -h localhost -U "$MIGRATION_DB_USER" -d "$MIGRATION_DB_NAME" < "$migration"
  done
fi

# Resuelve colisiones de container_name huérfanas. Los servicios usan
# container_name fijo (ej. emeltec-landing); si quedó un container de un
# COMPOSE_PROJECT_NAME anterior (o creado fuera de compose), `up` falla con
# "container name already in use" y --remove-orphans NO lo cubre. Removemos por
# nombre solo los que NO pertenecen al proyecto actual (los sanos no se tocan).
echo "Checking for orphaned fixed-name containers..."
while IFS= read -r cname; do
  [ -n "$cname" ] || continue
  cid="$(docker ps -aq --filter "name=^/${cname}$" || true)"
  [ -n "$cid" ] || continue
  proj="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$cid" 2>/dev/null || true)"
  if [ "$proj" != "$COMPOSE_PROJECT_NAME" ]; then
    echo "  Removing orphaned container '$cname' (project '${proj:-none}' != '$COMPOSE_PROJECT_NAME')"
    docker rm -f "$cid" >/dev/null
  fi
done < <(grep -E '^[[:space:]]*container_name:' "$COMPOSE_FILE" | sed -E 's/.*container_name:[[:space:]]*//; s/["'"'"']//g; s/\r//')

# Las imágenes de aplicación se construyen en CI (GitHub-hosted) y se publican en
# GHCR; aquí solo se descargan. NO se buildea en la VM (evita saturar la RAM).
# Requiere `docker login ghcr.io` previo: el workflow self-hosted lo hace con
# GITHUB_TOKEN; para un deploy manual por SSH, autenticar la VM una vez.
echo "Pulling application images from registry..."
docker compose -f "$COMPOSE_FILE" pull

echo "Restarting services (no build)..."
docker compose -f "$COMPOSE_FILE" up -d --no-build --remove-orphans

echo "Current containers:"
docker compose -f "$COMPOSE_FILE" ps

if command -v curl >/dev/null 2>&1 && [ -n "$HEALTHCHECK_URLS" ]; then
  IFS=',' read -ra URLS <<< "$HEALTHCHECK_URLS"
  for url in "${URLS[@]}"; do
    echo "Checking $url..."
    curl -fsS --max-time 15 "$url" >/dev/null
  done
fi

echo "Cleaning dangling Docker images..."
docker image prune -f >/dev/null

echo "Deploy completed successfully."
