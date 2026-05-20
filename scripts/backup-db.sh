#!/usr/bin/env bash
# Backup diario de TimescaleDB → Azure Blob Storage
# Formato: pg_dump -Fc (custom format, comprimido, compatible con hypertablas)
# Retención: Azure Lifecycle Policy se encarga (no se borran desde este script)
#
# Cron: 0 2 * * * /home/azureuser/emeltec3/scripts/backup-db.sh >> /var/log/emeltec-backup.log 2>&1
#
# Para restaurar:
#   az storage blob download --container-name "db-backups" --name "backup_YYYYMMDD_HHMMSS.dump" --file restore.dump
#   docker exec -i emeltec-db psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;"
#   pg_restore -U postgres -d telemetry_platform -Fc restore.dump
set -Eeuo pipefail

# ── Configuración ─────────────────────────────────────────────────────
APP_DIR="/home/azureuser/emeltec3"
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR="/tmp/emeltec-backups"
DB_CONTAINER="emeltec-db"
BLOB_CONTAINER="db-backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backup_${TIMESTAMP}.dump"

# ── Leer valor de .env ────────────────────────────────────────────────
read_env() {
  { grep -E "^${1}=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'
}

POSTGRES_USER=$(read_env POSTGRES_USER)
POSTGRES_DB=$(read_env POSTGRES_DB)
AZURE_CONN=$(read_env AZURE_STORAGE_CONNECTION_STRING)
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-telemetry_platform}"

# ── Validaciones previas ──────────────────────────────────────────────
if [ -z "$AZURE_CONN" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: AZURE_STORAGE_CONNECTION_STRING vacío en $ENV_FILE"
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: az CLI no instalado. Instalar con: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: container '$DB_CONTAINER' no está corriendo"
  exit 1
fi

# ── Crear container Azure si no existe ───────────────────────────────
az storage container create \
  --connection-string "$AZURE_CONN" \
  --name "$BLOB_CONTAINER" \
  --output none 2>/dev/null || true

# ── Generar backup ────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando pg_dump de '$POSTGRES_DB' (formato custom -Fc)..."

docker exec "$DB_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -Fc --no-acl --no-owner "$POSTGRES_DB" \
  > "$BACKUP_DIR/$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup generado: $BACKUP_FILE ($SIZE)"

# ── Subir a Azure Blob ────────────────────────────────────────────────
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Subiendo a Azure Blob ($BLOB_CONTAINER)..."

az storage blob upload \
  --connection-string "$AZURE_CONN" \
  --container-name "$BLOB_CONTAINER" \
  --name "$BACKUP_FILE" \
  --file "$BACKUP_DIR/$BACKUP_FILE" \
  --output none

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Upload exitoso: $BACKUP_FILE"

# ── Eliminar archivo local temporal ──────────────────────────────────
rm "$BACKUP_DIR/$BACKUP_FILE"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Backup completado exitosamente. Retención gestionada por Azure Lifecycle Policy."
