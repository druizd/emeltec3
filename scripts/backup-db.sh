#!/usr/bin/env bash
# Backup diario de TimescaleDB → Azure Blob Storage (Hot tier, retención 14 días)
# Formato: pg_dump -Fc (custom, compresión zlib integrada, compatible con hypertables)
#
# Cron: 0 3 * * * /home/azureuser/emeltec3/scripts/backup-db.sh >> /var/log/emeltec-backup.log 2>&1
#
# Restaurar:
#   az storage blob download --connection-string "$CONN" --container-name db-backups --name backup_YYYYMMDD_HHMMSS.dump --file restore.dump
#   docker exec -i emeltec-db psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"
#   docker exec -i emeltec-db pg_restore -U postgres -d telemetry_platform -Fc < restore.dump
set -Eeuo pipefail

# ── Configuración ─────────────────────────────────────────────────────────────
APP_DIR="/home/azureuser/emeltec3"
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR="/tmp/emeltec-backups"
DB_CONTAINER="emeltec-db"
BLOB_CONTAINER="db-backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backup_${TIMESTAMP}.dump"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── Leer .env ─────────────────────────────────────────────────────────────────
read_env() {
  { grep -E "^${1}=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'
}

POSTGRES_USER=$(read_env POSTGRES_USER)
POSTGRES_DB=$(read_env POSTGRES_DB)
AZURE_CONN=$(read_env AZURE_STORAGE_CONNECTION_STRING)
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-telemetry_platform}"

# ── Validaciones ──────────────────────────────────────────────────────────────
if [ -z "$AZURE_CONN" ]; then
  log "ERROR: AZURE_STORAGE_CONNECTION_STRING vacío en $ENV_FILE"
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  log "ERROR: az CLI no instalado — instalar: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  log "ERROR: container '$DB_CONTAINER' no está corriendo"
  exit 1
fi

# ── Crear container si no existe ──────────────────────────────────────────────
az storage container create \
  --connection-string "$AZURE_CONN" \
  --name "$BLOB_CONTAINER" \
  --output none 2>/dev/null || true

# ── Generar backup ────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
log "Iniciando pg_dump de '$POSTGRES_DB' (formato custom -Fc --compress=9)..."

docker exec "$DB_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -Fc --compress=9 --no-acl --no-owner "$POSTGRES_DB" \
  > "$BACKUP_DIR/$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
log "Dump generado: $BACKUP_FILE ($SIZE)"

# ── Subir a Azure Blob Hot ────────────────────────────────────────────────────
log "Subiendo a Azure Blob (Hot tier)..."

az storage blob upload \
  --connection-string "$AZURE_CONN" \
  --container-name "$BLOB_CONTAINER" \
  --name "$BACKUP_FILE" \
  --file "$BACKUP_DIR/$BACKUP_FILE" \
  --tier Hot \
  --output none

log "Upload exitoso: $BACKUP_FILE ($SIZE)"

# ── Limpiar temporal ──────────────────────────────────────────────────────────
rm "$BACKUP_DIR/$BACKUP_FILE"

log "Backup completado. Retención 14 días gestionada por Azure Lifecycle Policy."
