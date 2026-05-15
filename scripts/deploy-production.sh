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

if [ ! -f main-api/.env ]; then
  echo "ERROR: main-api/.env does not exist on the VM."
  echo "Create it from main-api/.env.example and fill the production values."
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
docker compose -f "$COMPOSE_FILE" config >/dev/null

read_env_value() {
  local key="$1"
  if [ ! -f main-api/.env ]; then
    return 0
  fi
  grep -E "^${key}=" main-api/.env | tail -n 1 | cut -d= -f2- | tr -d '\r'
}

MIGRATION_DB_USER="${MIGRATION_DB_USER:-$(read_env_value DB_USER)}"
MIGRATION_DB_NAME="${MIGRATION_DB_NAME:-$(read_env_value DB_NAME)}"
MIGRATION_DB_USER="${MIGRATION_DB_USER:-postgres}"
MIGRATION_DB_NAME="${MIGRATION_DB_NAME:-telemetry_platform}"

echo "Starting database service before migrations..."
docker compose -f "$COMPOSE_FILE" up -d timescaledb

if [ -d infra-db/migrations ]; then
  echo "Applying database migrations..."
  for migration in infra-db/migrations/*.sql; do
    [ -e "$migration" ] || continue
    echo "Applying $migration..."
    docker compose -f "$COMPOSE_FILE" exec -T timescaledb \
      psql -v ON_ERROR_STOP=1 -U "$MIGRATION_DB_USER" -d "$MIGRATION_DB_NAME" < "$migration"
  done
fi

echo "Building and restarting services..."
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

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
