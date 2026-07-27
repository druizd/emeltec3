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
HEARTBEAT_BLOB="heartbeat/last-success.json"
MIN_DUMP_BYTES=1048576  # 1 MiB — dump menor que esto es sospechoso
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="backup_${TIMESTAMP}.dump"
START_EPOCH=$(date +%s)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

notify() {
  # notify <status> <message>
  # Envía payload JSON al webhook si BACKUP_WEBHOOK_URL está definido.
  local status="$1"
  local message="$2"
  local url="${BACKUP_WEBHOOK_URL:-}"
  [ -z "$url" ] && return 0
  local payload
  payload=$(printf '{"service":"backup-db","status":"%s","host":"%s","file":"%s","message":%s,"timestamp":"%s"}' \
    "$status" "$(hostname)" "$BACKUP_FILE" "$(printf '%s' "$message" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  curl -fsS -m 10 -X POST -H "Content-Type: application/json" -d "$payload" "$url" >/dev/null 2>&1 || true
}

on_error() {
  local exit_code=$?
  local line=$1
  local tail_log
  tail_log=$(tail -n 20 "${BACKUP_LOG:-/dev/null}" 2>/dev/null || true)
  log "FALLO en línea $line (exit=$exit_code)"
  notify "fail" "backup falló línea $line exit=$exit_code. Últimas líneas: $tail_log"
  # Limpiar temporales (plano + cifrado si quedaron)
  rm -f "$BACKUP_DIR/backup_${TIMESTAMP}.dump" "$BACKUP_DIR/backup_${TIMESTAMP}.dump.gpg" "$BACKUP_DIR/heartbeat.json" 2>/dev/null || true
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# ── Leer .env ─────────────────────────────────────────────────────────────────
read_env() {
  { grep -E "^${1}=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'
}

POSTGRES_USER=$(read_env POSTGRES_USER)
POSTGRES_DB=$(read_env POSTGRES_DB)
AZURE_CONN=$(read_env AZURE_STORAGE_CONNECTION_STRING)
GPG_PASSPHRASE_FILE=$(read_env BACKUP_GPG_PASSPHRASE_FILE)
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-telemetry_platform}"

# Si BACKUP_GPG_PASSPHRASE_FILE está definido y apunta a un archivo válido,
# se cifra el dump con GPG symmetric AES256 antes de subir.
ENCRYPT=0
if [ -n "$GPG_PASSPHRASE_FILE" ]; then
  if [ ! -r "$GPG_PASSPHRASE_FILE" ]; then
    log "ERROR: BACKUP_GPG_PASSPHRASE_FILE definido ($GPG_PASSPHRASE_FILE) pero no legible"
    exit 1
  fi
  if ! command -v gpg >/dev/null 2>&1; then
    log "ERROR: gpg no instalado (requerido por BACKUP_GPG_PASSPHRASE_FILE). Instalar: sudo apt install gnupg"
    exit 1
  fi
  ENCRYPT=1
fi

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
SIZE_BYTES=$(stat -c%s "$BACKUP_DIR/$BACKUP_FILE")
log "Dump generado: $BACKUP_FILE ($SIZE, $SIZE_BYTES bytes)"

# ── Verificar tamaño mínimo ───────────────────────────────────────────────────
if [ "$SIZE_BYTES" -lt "$MIN_DUMP_BYTES" ]; then
  log "ERROR: dump demasiado chico ($SIZE_BYTES bytes < $MIN_DUMP_BYTES). Posible fallo mid-stream."
  exit 1
fi

# ── Verificar integridad del dump con pg_restore --list ───────────────────────
log "Verificando integridad del dump..."
if ! docker exec -i "$DB_CONTAINER" pg_restore --list < "$BACKUP_DIR/$BACKUP_FILE" > /dev/null 2>&1; then
  log "ERROR: pg_restore --list falló. Dump corrupto — abortando upload."
  exit 1
fi
log "Dump verificado OK."

# ── Calcular checksum SHA-256 del dump plano ─────────────────────────────────
SHA256_PLAIN=$(sha256sum "$BACKUP_DIR/$BACKUP_FILE" | cut -d' ' -f1)
log "SHA-256 (plano): $SHA256_PLAIN"

# ── Cifrar con GPG (si corresponde) ───────────────────────────────────────────
UPLOAD_NAME="$BACKUP_FILE"
UPLOAD_PATH="$BACKUP_DIR/$BACKUP_FILE"
UPLOAD_SIZE_BYTES="$SIZE_BYTES"
UPLOAD_SHA256="$SHA256_PLAIN"
ENCRYPTION_META=""

if [ "$ENCRYPT" -eq 1 ]; then
  log "Cifrando con GPG symmetric AES-256..."
  ENC_FILE="${BACKUP_FILE}.gpg"
  gpg --batch --yes \
      --symmetric --cipher-algo AES256 \
      --compress-algo none \
      --passphrase-file "$GPG_PASSPHRASE_FILE" \
      --output "$BACKUP_DIR/$ENC_FILE" \
      "$BACKUP_DIR/$BACKUP_FILE"

  ENC_SIZE_BYTES=$(stat -c%s "$BACKUP_DIR/$ENC_FILE")
  ENC_SHA256=$(sha256sum "$BACKUP_DIR/$ENC_FILE" | cut -d' ' -f1)
  log "Cifrado OK: $ENC_FILE ($ENC_SIZE_BYTES bytes, SHA-256 $ENC_SHA256)"

  # Borrar el dump plano — solo sube el cifrado
  rm "$BACKUP_DIR/$BACKUP_FILE"

  UPLOAD_NAME="$ENC_FILE"
  UPLOAD_PATH="$BACKUP_DIR/$ENC_FILE"
  UPLOAD_SIZE_BYTES="$ENC_SIZE_BYTES"
  UPLOAD_SHA256="$ENC_SHA256"
  ENCRYPTION_META="encrypted=true cipher=AES256 sha256_plain=$SHA256_PLAIN size_bytes_plain=$SIZE_BYTES"
  # BACKUP_FILE apunta al nombre que se sube (para notify / heartbeat / cleanup)
  BACKUP_FILE="$ENC_FILE"
fi

# ── Subir a Azure Blob Hot ────────────────────────────────────────────────────
log "Subiendo a Azure Blob (Hot tier): $UPLOAD_NAME"

# shellcheck disable=SC2086
az storage blob upload \
  --connection-string "$AZURE_CONN" \
  --container-name "$BLOB_CONTAINER" \
  --name "$UPLOAD_NAME" \
  --file "$UPLOAD_PATH" \
  --tier Hot \
  --metadata "sha256=$UPLOAD_SHA256" "size_bytes=$UPLOAD_SIZE_BYTES" "source_host=$(hostname)" $ENCRYPTION_META \
  --output none

log "Upload exitoso: $UPLOAD_NAME ($UPLOAD_SIZE_BYTES bytes)"

# ── Limpiar temporal ──────────────────────────────────────────────────────────
rm "$UPLOAD_PATH"

# ── Heartbeat: escribir blob con último éxito ─────────────────────────────────
DURATION=$(( $(date +%s) - START_EPOCH ))
HEARTBEAT_FILE="$BACKUP_DIR/heartbeat.json"
if [ "$ENCRYPT" -eq 1 ]; then
  ENCRYPTED_JSON="true"
  CIPHER_JSON='"AES256"'
  SHA256_PLAIN_JSON="\"$SHA256_PLAIN\""
else
  ENCRYPTED_JSON="false"
  CIPHER_JSON="null"
  SHA256_PLAIN_JSON="null"
fi
cat > "$HEARTBEAT_FILE" <<EOF
{
  "last_success_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_file": "$BACKUP_FILE",
  "size_bytes": $UPLOAD_SIZE_BYTES,
  "sha256": "$UPLOAD_SHA256",
  "encrypted": $ENCRYPTED_JSON,
  "cipher": $CIPHER_JSON,
  "sha256_plain": $SHA256_PLAIN_JSON,
  "duration_seconds": $DURATION,
  "host": "$(hostname)"
}
EOF

az storage blob upload \
  --connection-string "$AZURE_CONN" \
  --container-name "$BLOB_CONTAINER" \
  --name "$HEARTBEAT_BLOB" \
  --file "$HEARTBEAT_FILE" \
  --overwrite \
  --output none

rm "$HEARTBEAT_FILE"

log "Heartbeat actualizado ($HEARTBEAT_BLOB). Duración: ${DURATION}s."
notify "success" "backup $BACKUP_FILE (${UPLOAD_SIZE_BYTES}B, cifrado=$ENCRYPTED_JSON, ${DURATION}s) OK"

log "Backup completado. Retención 14 días gestionada por Azure Lifecycle Policy."
