#!/usr/bin/env bash
# scripts/check-db-health.sh — Pre-chequeo de salud de la DB, 2h antes del backup diario.
# Corre los MISMOS chequeos que backup-db.sh corre justo antes de dumpear
# (tablas/hypertables > 0, sin regresión vs. el último backup exitoso), pero
# sin dumpear ni subir nada. Si algo está mal, manda un email — da una
# ventana de ~2h para arreglarlo antes de que backup-db.sh lo intente a las 03:00
# y aborte sin subir nada.
#
# Cron: 0 1 * * * /home/azureuser/emeltec3/scripts/check-db-health.sh >> /var/log/emeltec-db-health.log 2>&1
#
# Solo manda email si algo está mal — corrida sana no genera correo (no es spam diario).
set -Eeuo pipefail

# ── Configuración ─────────────────────────────────────────────────────────────
APP_DIR="/home/azureuser/emeltec3"
ENV_FILE="$APP_DIR/.env"
DB_CONTAINER="emeltec-db"
BLOB_CONTAINER="db-backups"
HEARTBEAT_BLOB="heartbeat/last-success.json"
WORK_DIR="/tmp/emeltec-db-health"

# TEST: solo mcid. Producción: agregar nlira y druiz (mismo criterio que monitor.sh)
TO_EMAILS=("mcid@emeltec.cl")

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

read_env() {
  { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'
}

POSTGRES_USER=$(read_env POSTGRES_USER)
POSTGRES_DB=$(read_env POSTGRES_DB)
AZURE_CONN=$(read_env AZURE_STORAGE_CONNECTION_STRING)
RESEND_API_KEY=$(read_env RESEND_API_KEY)
RESEND_FROM=$(read_env RESEND_FROM)
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-telemetry_platform}"
RESEND_FROM="${RESEND_FROM:-Emeltec Cloud <noreply@emeltec.cl>}"

# ── Email (mismo motor visual que monitor.sh) ─────────────────────────────────
escape_html() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

make_rows() {
  local out="" safe1 safe2
  while [[ $# -ge 2 ]]; do
    safe1=$(escape_html "$1")
    safe2=$(escape_html "$2")
    out+="<tr>"
    out+="<td style='padding:7px 0;font-size:12px;color:#64748B;width:40%;vertical-align:top;'><strong>$safe1</strong></td>"
    out+="<td style='padding:7px 0;font-size:13px;color:#1E293B;vertical-align:top;'>$safe2</td>"
    out+="</tr>"
    shift 2
  done
  echo "$out"
}

info_block() {
  local rows="$1"
  echo "<table width='100%' cellpadding='0' cellspacing='0'
             style='border-top:1px solid #E2E8F0;padding-top:12px;margin-bottom:8px;'>
    $rows
  </table>"
}

note_box() {
  local bg="$1" border="$2" color="$3" text="$4"
  echo "<p style='margin:16px 0 0;padding:12px;background:${bg};border:1px solid ${border};
                  border-radius:8px;font-size:12px;color:${color};'>$text</p>"
}

make_html() {
  local bg="$1" icon="$2" title="$3" inner="$4"
  local ts
  ts=$(date '+%d/%m/%Y %H:%M:%S')
  cat <<HTML
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0"
       style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;max-width:580px;">
  <tr>
    <td style="background:${bg};padding:20px 32px;">
      <span style="font-size:20px;font-weight:700;color:#fff;">${icon} ${title}</span>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 32px;">
      ${inner}
    </td>
  </tr>
  <tr>
    <td style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:12px 32px;
               font-size:11px;color:#94A3B8;text-align:center;">
      Emeltec Cloud &mdash; Pre-chequeo backup DB &mdash; ${ts}
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>
HTML
}

send_email() {
  local subject="$1" text_body="$2" html_body="$3"

  if [[ -z "${RESEND_API_KEY:-}" ]]; then
    log "WARN: RESEND_API_KEY vacío — simulando: $subject"
    return 0
  fi

  for email in "${TO_EMAILS[@]}"; do
    local ts tt th tp tr
    ts=$(mktemp); tt=$(mktemp); th=$(mktemp); tp=$(mktemp); tr=$(mktemp)
    printf '%s' "$subject"   > "$ts"
    printf '%s' "$text_body" > "$tt"
    printf '%s' "$html_body" > "$th"

    node -e "
const fs = require('fs');
const a = process.argv;
const to_addr   = a[a.length - 1];
const from_addr = a[a.length - 2];
const h_file    = a[a.length - 3];
const t_file    = a[a.length - 4];
const s_file    = a[a.length - 5];
const payload = {
  from:    from_addr,
  to:      to_addr,
  subject: fs.readFileSync(s_file, 'utf8'),
  text:    fs.readFileSync(t_file, 'utf8'),
  html:    fs.readFileSync(h_file, 'utf8'),
};
process.stdout.write(JSON.stringify(payload));
" "$ts" "$tt" "$th" "$RESEND_FROM" "$email" > "$tp"

    rm -f "$ts" "$tt" "$th"

    local code
    code=$(curl -s -o "$tr" -w '%{http_code}' --max-time 10 \
      -X POST 'https://api.resend.com/emails' \
      -H "Authorization: Bearer $RESEND_API_KEY" \
      -H 'Content-Type: application/json' \
      --data-binary "@$tp")

    if [[ "$code" == "200" || "$code" == "201" ]]; then
      log "Email OK → $email [$subject]"
    else
      log "Email ERROR HTTP $code → $email [$subject] — $(cat "$tr")"
    fi

    rm -f "$tp" "$tr"
  done
}

# ── Si el chequeo mismo falla (az/docker/etc rotos), avisar igual ────────────
on_error() {
  local exit_code=$?
  local line=$1
  log "FALLO en línea $line (exit=$exit_code)"
  send_email "⚠️ [PRE-BACKUP] el chequeo de salud de la DB falló al ejecutarse" \
    "check-db-health.sh falló en línea $line (exit=$exit_code) — no se pudo verificar si la DB está lista para el backup de las 03:00. Revisar manualmente." \
    "$(make_html '#d97706' '⚠️' 'El chequeo mismo falló' "$(info_block "$(make_rows 'Línea' "$line" 'Exit code' "$exit_code")")$(note_box '#FFFBEB' '#FDE68A' '#92400E' 'No se pudo confirmar el estado de la DB antes del backup. Revisar a mano antes de las 03:00.')")"
  rm -rf "$WORK_DIR"
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

# ── Chequeos (mismos que el pre-dump de backup-db.sh) ─────────────────────────
mkdir -p "$WORK_DIR"
log "=== Pre-chequeo DB (2h antes del backup 03:00) — inicio ==="

PROBLEMS=()

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  PROBLEMS+=("Container '$DB_CONTAINER' no está corriendo.")
elif ! docker exec "$DB_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
  PROBLEMS+=("Postgres no responde en '$DB_CONTAINER' (pg_isready falló).")
else
  TABLE_COUNT=$(docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo 0)
  HYPER_COUNT=$(docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
    "SELECT count(*) FROM timescaledb_information.hypertables;" 2>/dev/null || echo 0)
  TABLE_COUNT=$(printf '%s' "$TABLE_COUNT" | tr -d ' \r\n')
  HYPER_COUNT=$(printf '%s' "$HYPER_COUNT" | tr -d ' \r\n')
  case "$TABLE_COUNT" in ''|*[!0-9]*) TABLE_COUNT=0 ;; esac
  case "$HYPER_COUNT" in ''|*[!0-9]*) HYPER_COUNT=0 ;; esac

  log "DB: $TABLE_COUNT tablas, $HYPER_COUNT hypertables."

  [ "$TABLE_COUNT" -lt 1 ] && PROBLEMS+=("DB sin tablas en schema public. Posible DB rota o borrada.")
  [ "$HYPER_COUNT" -lt 1 ] && PROBLEMS+=("DB sin hypertables. Extensión TimescaleDB caída o DB rota.")

  # Comparar contra el último heartbeat exitoso (mismo que compara backup-db.sh)
  if [ -n "$AZURE_CONN" ] && command -v az >/dev/null 2>&1; then
    HB_FILE="$WORK_DIR/last-heartbeat.json"
    rm -f "$HB_FILE"
    az storage blob download \
      --connection-string "$AZURE_CONN" \
      --container-name "$BLOB_CONTAINER" \
      --name "$HEARTBEAT_BLOB" \
      --file "$HB_FILE" \
      --output none >/dev/null 2>&1 || true

    if [ -f "$HB_FILE" ]; then
      HB_JSON=$(cat "$HB_FILE")
      PREV_TABLE=$(printf '%s' "$HB_JSON" | grep -oP '"table_count"\s*:\s*\K[0-9]+' || true)
      PREV_HYPER=$(printf '%s' "$HB_JSON" | grep -oP '"hypertable_count"\s*:\s*\K[0-9]+' || true)

      if [ -n "$PREV_TABLE" ] && [ "$TABLE_COUNT" -lt "$PREV_TABLE" ]; then
        PROBLEMS+=("Tablas bajaron de $PREV_TABLE a $TABLE_COUNT vs. el último backup exitoso — posible borrado accidental.")
      fi
      if [ -n "$PREV_HYPER" ] && [ "$HYPER_COUNT" -lt "$PREV_HYPER" ]; then
        PROBLEMS+=("Hypertables bajaron de $PREV_HYPER a $HYPER_COUNT vs. el último backup exitoso — posible borrado accidental.")
      fi
    fi
    rm -f "$HB_FILE"
  fi
fi

if [ "${#PROBLEMS[@]}" -eq 0 ]; then
  log "OK: DB lista para el backup de las 03:00."
else
  log "PROBLEMA: DB no está lista para el backup — ${#PROBLEMS[@]} issue(s)."
  ROWS_ARGS=()
  i=1
  for p in "${PROBLEMS[@]}"; do
    ROWS_ARGS+=("Problema $i" "$p")
    i=$((i+1))
  done
  rows=$(make_rows "${ROWS_ARGS[@]}")
  inner=$(info_block "$rows")
  inner+=$(note_box "#FEF2F2" "#FECACA" "#DC2626" \
    "El backup diario intenta correr a las <strong>03:00</strong>. Si esto no se corrige antes, <code>backup-db.sh</code> va a abortar y <strong>no va a subir nada</strong> ese día (por diseño — mejor no subir que subir un backup de una DB rota).")
  send_email "🟡 [PRE-BACKUP] DB no lista para el backup de las 03:00 — revisar" \
    "DB con problemas 2h antes del backup diario: ${PROBLEMS[*]}" \
    "$(make_html '#d97706' '🟡' 'DB no lista para el backup de esta noche' "$inner")"
fi

rm -rf "$WORK_DIR"
log "=== Pre-chequeo DB — fin ==="
