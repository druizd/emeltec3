#!/usr/bin/env bash
# Verify weekly: descarga el último backup de Azure Blob, verifica hash,
# lo restaura en un container Postgres+TimescaleDB efímero y corre queries
# de smoke sobre tablas clave. Notifica éxito/fallo por webhook.
#
# Cron sugerido: 0 4 * * 0 /home/azureuser/emeltec3/scripts/verify-backup.sh >> /var/log/emeltec-verify.log 2>&1
#
# Requisitos: docker, az CLI, jq, sha256sum, curl (opcional).
set -Eeuo pipefail

# ── Configuración ─────────────────────────────────────────────────────────────
APP_DIR="/home/azureuser/emeltec3"
ENV_FILE="$APP_DIR/.env"
WORK_DIR="/tmp/emeltec-verify"
BLOB_CONTAINER="db-backups"
VERIFY_CONTAINER="emeltec-verify-db"
VERIFY_IMAGE="timescale/timescaledb:latest-pg16"
VERIFY_PORT="55433"
VERIFY_PASSWORD="verify_only_$(date +%s)"
VERIFY_DB="telemetry_platform"
START_EPOCH=$(date +%s)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

read_env() {
  { grep -E "^${1}=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'
}

AZURE_CONN=$(read_env AZURE_STORAGE_CONNECTION_STRING)
WEBHOOK_URL=$(read_env BACKUP_WEBHOOK_URL)
GPG_PASSPHRASE_FILE=$(read_env BACKUP_GPG_PASSPHRASE_FILE)

notify() {
  # notify <status> <message>
  local status="$1"
  local message="$2"
  [ -z "$WEBHOOK_URL" ] && return 0
  local payload
  payload=$(printf '{"service":"verify-backup","status":"%s","host":"%s","file":"%s","message":%s,"timestamp":"%s"}' \
    "$status" "$(hostname)" "${BACKUP_FILE:-unknown}" \
    "$(printf '%s' "$message" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
  curl -fsS -m 10 -X POST -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL" >/dev/null 2>&1 || true
}

cleanup() {
  docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}

on_error() {
  local exit_code=$?
  local line=$1
  log "FALLO en línea $line (exit=$exit_code)"
  notify "fail" "verify-backup falló línea $line exit=$exit_code para archivo ${BACKUP_FILE:-unknown}"
  cleanup
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

# ── Validaciones ──────────────────────────────────────────────────────────────
[ -z "$AZURE_CONN" ] && { log "ERROR: AZURE_STORAGE_CONNECTION_STRING vacío"; exit 1; }
command -v az     >/dev/null 2>&1 || { log "ERROR: az CLI no instalado"; exit 1; }
command -v docker >/dev/null 2>&1 || { log "ERROR: docker no instalado"; exit 1; }
command -v jq     >/dev/null 2>&1 || { log "ERROR: jq no instalado"; exit 1; }

mkdir -p "$WORK_DIR"

# ── Elegir último backup ──────────────────────────────────────────────────────
log "Listando último backup en '$BLOB_CONTAINER'..."
# Acepta backup_*.dump o backup_*.dump.gpg — filtra excluyendo heartbeat/
BACKUP_FILE=$(az storage blob list \
  --connection-string "$AZURE_CONN" \
  --container-name "$BLOB_CONTAINER" \
  --prefix "backup_" \
  --query "sort_by([?ends_with(name, '.dump') || ends_with(name, '.dump.gpg')], &properties.lastModified)[-1].name" \
  -o tsv)

[ -z "$BACKUP_FILE" ] && { log "ERROR: sin backups en el container"; exit 1; }
log "Último backup: $BACKUP_FILE"

# ── Descargar ─────────────────────────────────────────────────────────────────
# Si el blob termina en .gpg, primero se descarga cifrado y luego se descifra.
IS_ENCRYPTED=0
case "$BACKUP_FILE" in
  *.gpg) IS_ENCRYPTED=1 ;;
esac

DOWNLOAD_PATH="$WORK_DIR/download.bin"
LOCAL_DUMP="$WORK_DIR/restore.dump"
log "Descargando..."
az storage blob download \
  --connection-string "$AZURE_CONN" \
  --container-name "$BLOB_CONTAINER" \
  --name "$BACKUP_FILE" \
  --file "$DOWNLOAD_PATH" \
  --output none

DOWNLOAD_SIZE=$(stat -c%s "$DOWNLOAD_PATH")
log "Descargado: $DOWNLOAD_SIZE bytes"

# ── Verificar checksum contra metadata del blob ───────────────────────────────
EXPECTED_SHA=$(az storage blob show \
  --connection-string "$AZURE_CONN" \
  --container-name "$BLOB_CONTAINER" \
  --name "$BACKUP_FILE" \
  --query "metadata.sha256" -o tsv)

if [ -n "$EXPECTED_SHA" ]; then
  ACTUAL_SHA=$(sha256sum "$DOWNLOAD_PATH" | cut -d' ' -f1)
  if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
    log "ERROR: SHA-256 mismatch. Esperado=$EXPECTED_SHA Actual=$ACTUAL_SHA"
    exit 1
  fi
  log "SHA-256 verificado: $ACTUAL_SHA"
else
  log "WARN: blob sin metadata sha256. Continuando sin verificar hash del cifrado/plano."
fi

# ── Descifrar si corresponde ──────────────────────────────────────────────────
if [ "$IS_ENCRYPTED" -eq 1 ]; then
  if [ -z "$GPG_PASSPHRASE_FILE" ]; then
    log "ERROR: blob cifrado (.gpg) pero BACKUP_GPG_PASSPHRASE_FILE no está definido en .env"
    exit 1
  fi
  if [ ! -r "$GPG_PASSPHRASE_FILE" ]; then
    log "ERROR: passphrase file no legible ($GPG_PASSPHRASE_FILE)"
    exit 1
  fi
  if ! command -v gpg >/dev/null 2>&1; then
    log "ERROR: gpg no instalado. sudo apt install gnupg"
    exit 1
  fi
  log "Descifrando con GPG..."
  gpg --batch --yes --decrypt \
      --passphrase-file "$GPG_PASSPHRASE_FILE" \
      --output "$LOCAL_DUMP" \
      "$DOWNLOAD_PATH"
  rm "$DOWNLOAD_PATH"

  # Verificar hash del plano contra metadata sha256_plain (si existe)
  EXPECTED_PLAIN=$(az storage blob show \
    --connection-string "$AZURE_CONN" \
    --container-name "$BLOB_CONTAINER" \
    --name "$BACKUP_FILE" \
    --query "metadata.sha256_plain" -o tsv)
  if [ -n "$EXPECTED_PLAIN" ]; then
    ACTUAL_PLAIN=$(sha256sum "$LOCAL_DUMP" | cut -d' ' -f1)
    if [ "$EXPECTED_PLAIN" != "$ACTUAL_PLAIN" ]; then
      log "ERROR: SHA-256 (plano) mismatch tras descifrar. Esperado=$EXPECTED_PLAIN Actual=$ACTUAL_PLAIN"
      exit 1
    fi
    log "SHA-256 (plano) verificado tras descifrado."
  fi
else
  mv "$DOWNLOAD_PATH" "$LOCAL_DUMP"
fi

SIZE_BYTES=$(stat -c%s "$LOCAL_DUMP")

# ── Levantar container efímero ────────────────────────────────────────────────
log "Levantando container efímero '$VERIFY_CONTAINER' (imagen: $VERIFY_IMAGE)..."
docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm \
  --name "$VERIFY_CONTAINER" \
  -e POSTGRES_PASSWORD="$VERIFY_PASSWORD" \
  -e POSTGRES_DB="$VERIFY_DB" \
  -p "127.0.0.1:${VERIFY_PORT}:5432" \
  "$VERIFY_IMAGE" >/dev/null

# Esperar readiness
log "Esperando que Postgres arranque..."
for i in $(seq 1 30); do
  if docker exec "$VERIFY_CONTAINER" pg_isready -U postgres -d "$VERIFY_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    log "ERROR: Postgres no arrancó en 30s"
    docker logs "$VERIFY_CONTAINER" | tail -n 30
    exit 1
  fi
done
log "Postgres listo."

# ── Crear extensión TimescaleDB ───────────────────────────────────────────────
docker exec -i "$VERIFY_CONTAINER" psql -U postgres -d "$VERIFY_DB" \
  -c "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;" >/dev/null

# ── Restaurar ─────────────────────────────────────────────────────────────────
log "Restaurando dump ($SIZE_BYTES bytes)..."
RESTORE_LOG="$WORK_DIR/restore.log"
if ! docker exec -i "$VERIFY_CONTAINER" \
     pg_restore -U postgres -d "$VERIFY_DB" --no-owner --no-acl \
     < "$LOCAL_DUMP" > "$RESTORE_LOG" 2>&1; then
  log "ERROR: pg_restore falló. Últimas líneas:"
  tail -n 20 "$RESTORE_LOG"
  exit 1
fi

# Tolerar warnings pero contarlos
WARN_COUNT=$(grep -c "WARNING\|warning" "$RESTORE_LOG" 2>/dev/null || echo 0)
ERR_COUNT=$(grep -c "ERROR\|error" "$RESTORE_LOG" 2>/dev/null || echo 0)
log "Restore OK (warnings=$WARN_COUNT, errors=$ERR_COUNT)."

# ── Smoke queries ─────────────────────────────────────────────────────────────
log "Corriendo smoke queries..."

# Chequeo genérico: extensión activa
EXT_OK=$(docker exec -i "$VERIFY_CONTAINER" psql -U postgres -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM pg_extension WHERE extname='timescaledb';")
[ "$EXT_OK" != "1" ] && { log "ERROR: TimescaleDB extension no cargada"; exit 1; }

# Contar tablas del schema public
TABLE_COUNT=$(docker exec -i "$VERIFY_CONTAINER" psql -U postgres -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
log "Tablas en public: $TABLE_COUNT"
[ "$TABLE_COUNT" -lt 1 ] && { log "ERROR: DB restaurada sin tablas"; exit 1; }

# Contar hypertables
HYPER_COUNT=$(docker exec -i "$VERIFY_CONTAINER" psql -U postgres -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM timescaledb_information.hypertables;" 2>/dev/null || echo 0)
log "Hypertables: $HYPER_COUNT"

# Chequeo de datos recientes en la primera hypertable (best-effort)
FIRST_HYPER=$(docker exec -i "$VERIFY_CONTAINER" psql -U postgres -d "$VERIFY_DB" -tAc \
  "SELECT hypertable_name FROM timescaledb_information.hypertables LIMIT 1;" 2>/dev/null || echo "")
RECENT_ROWS="skipped"
if [ -n "$FIRST_HYPER" ]; then
  # Buscar columna timestamp típica (created_at, time, ts, timestamp)
  TIME_COL=$(docker exec -i "$VERIFY_CONTAINER" psql -U postgres -d "$VERIFY_DB" -tAc \
    "SELECT column_name FROM information_schema.columns
     WHERE table_name='$FIRST_HYPER'
       AND data_type LIKE 'timestamp%'
     ORDER BY CASE column_name
       WHEN 'created_at' THEN 1
       WHEN 'time' THEN 2
       WHEN 'ts' THEN 3
       WHEN 'timestamp' THEN 4 ELSE 9 END
     LIMIT 1;" 2>/dev/null || echo "")
  if [ -n "$TIME_COL" ]; then
    RECENT_ROWS=$(docker exec -i "$VERIFY_CONTAINER" psql -U postgres -d "$VERIFY_DB" -tAc \
      "SELECT count(*) FROM \"$FIRST_HYPER\" WHERE \"$TIME_COL\" > now() - interval '2 days';" 2>/dev/null || echo "err")
    log "Filas en '$FIRST_HYPER' últimas 48h ('$TIME_COL'): $RECENT_ROWS"
  fi
fi

DURATION=$(( $(date +%s) - START_EPOCH ))
MSG="verify-backup OK: file=$BACKUP_FILE size=${SIZE_BYTES}B tables=$TABLE_COUNT hypertables=$HYPER_COUNT recent_rows=$RECENT_ROWS warnings=$WARN_COUNT duration=${DURATION}s"
log "$MSG"
notify "success" "$MSG"

# cleanup corre por trap EXIT
