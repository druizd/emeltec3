#!/usr/bin/env bash
# scripts/monitor.sh — Emeltec infrastructure health monitor
# Cron: */5 * * * * /home/azureuser/emeltec3/scripts/monitor.sh >> /var/log/emeltec-monitor.log 2>&1

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"
STATE_DIR="/tmp/emeltec-monitor"
YELLOW_MIN=5
RED_MIN=10

# TEST: solo mcid. Producción: agregar nlira y druiz
TO_EMAILS=("mcid@emeltec.cl")

CONTAINERS=(
  emeltec-db
  emeltec-api
  emeltec-linux-db-api
  emeltec-redis
  emeltec-auth
  emeltec-frontend
  emeltec-csvconsumer
  emeltec-ftpconsumer
)

# ── Bootstrap ─────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
mkdir -p "$STATE_DIR"

read_env() {
  { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | tr -d '\r'
}

RESEND_API_KEY=$(read_env RESEND_API_KEY)
RESEND_FROM=$(read_env RESEND_FROM)
POSTGRES_USER=$(read_env POSTGRES_USER)
POSTGRES_DB=$(read_env POSTGRES_DB)
RESEND_FROM="${RESEND_FROM:-Emeltec Cloud <noreply@emeltec.cl>}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-telemetry_platform}"

# ── State ─────────────────────────────────────────────────────────────────────
# One file per alert key — contains: ok / yellow / red / down / missing
get_state() { cat "${STATE_DIR}/${1}" 2>/dev/null || echo "ok"; }
set_state()  { printf '%s' "$2" > "${STATE_DIR}/${1}"; }

# ── HTML builders ──────────────────────────────────────────────────────────────
make_rows() {
  local out=""
  while [[ $# -ge 2 ]]; do
    out+="<tr>"
    out+="<td style='padding:7px 0;font-size:12px;color:#64748B;width:40%;vertical-align:top;'><strong>$1</strong></td>"
    out+="<td style='padding:7px 0;font-size:13px;color:#1E293B;vertical-align:top;'>$2</td>"
    out+="</tr>"
    shift 2
  done
  echo "$out"
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
      Emeltec Cloud &mdash; Monitor automático &mdash; ${ts}
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>
HTML
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

# ── Email ─────────────────────────────────────────────────────────────────────
send_email() {
  local subject="$1" text_body="$2" html_body="$3"

  if [[ -z "${RESEND_API_KEY:-}" ]]; then
    log "WARN: RESEND_API_KEY vacío — simulando: $subject"
    return 0
  fi

  for email in "${TO_EMAILS[@]}"; do
    # Write content to temp files — avoids argv length limits and -- offset issues
    local ts tt th tp tr
    ts=$(mktemp); tt=$(mktemp); th=$(mktemp); tp=$(mktemp); tr=$(mktemp)
    printf '%s' "$subject"   > "$ts"
    printf '%s' "$text_body" > "$tt"
    printf '%s' "$html_body" > "$th"

    # Access args from the END — avoids argv[0..1] offset differences across Node versions/OS
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
    code=$(curl -s -o "$tr" -w '%{http_code}' \
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

# ── Container check ───────────────────────────────────────────────────────────
check_container() {
  local name="$1"
  local key="c_${name}"
  local prev
  prev=$(get_state "$key")

  if ! docker inspect "$name" >/dev/null 2>&1; then
    [[ "$prev" == "missing" ]] && { log "SKIP $name (ya alertado: missing)"; return; }
    set_state "$key" "missing"
    local rows
    rows=$(make_rows "Container" "$name" "Estado" "No existe en Docker" \
                     "Acción" "Verificar docker-compose")
    local inner
    inner=$(info_block "$rows")
    inner+=$(note_box "#FEF2F2" "#FECACA" "#DC2626" \
      "El container no existe. Verificar que <code>docker-compose</code> esté levantado.")
    send_email "🔴 [CAÍDO] $name — no encontrado" \
      "Container $name no existe en Docker. $(date)" \
      "$(make_html '#dc2626' '🔴' "Container no encontrado: $name" "$inner")"
    return
  fi

  local status exit_code
  status=$(docker inspect --format='{{.State.Status}}' "$name")
  exit_code=$(docker inspect --format='{{.State.ExitCode}}' "$name")

  if [[ "$status" != "running" ]]; then
    [[ "$prev" == "down" ]] && { log "SKIP $name (ya alertado: down)"; return; }
    set_state "$key" "down"

    local raw_logs safe_logs
    raw_logs=$(docker logs --tail 30 "$name" 2>&1 || echo "(sin logs disponibles)")
    safe_logs=$(printf '%s' "$raw_logs" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')

    local rows
    rows=$(make_rows "Container" "$name" "Estado" "$status" "Exit code" "$exit_code")
    local inner
    inner=$(info_block "$rows")
    inner+="<p style='margin:16px 0 4px;font-size:12px;color:#64748B;'><strong>Últimas líneas de log:</strong></p>"
    inner+="<pre style='background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:10px;
                         font-size:11px;color:#334155;white-space:pre-wrap;overflow-x:auto;'>$safe_logs</pre>"

    send_email "🔴 [CAÍDO] $name — exit $exit_code" \
      "Container $name cayó. Estado: $status. Exit: $exit_code. $(date)" \
      "$(make_html '#dc2626' '🔴' "Container caído: $name" "$inner")"
  else
    if [[ "$prev" == "down" || "$prev" == "missing" ]]; then
      set_state "$key" "ok"
      local rows
      rows=$(make_rows "Container" "$name" "Estado" "running" \
                       "Recuperado" "$(date '+%d/%m/%Y %H:%M:%S')")
      send_email "✅ [RECUPERADO] $name — running" \
        "Container $name está running nuevamente. $(date)" \
        "$(make_html '#16a34a' '✅' "Container recuperado: $name" "$(info_block "$rows")")"
    else
      set_state "$key" "ok"
      log "OK $name: running"
    fi
  fi
}

# ── Data flow check ───────────────────────────────────────────────────────────
check_flow() {
  local key="$1" label="$2" container="$3" min_query="$4" last_query="$5"
  local state_key="f_${key}"
  local prev
  prev=$(get_state "$state_key")

  # Skip if DB is down (already alerted separately)
  local db_status
  db_status=$(docker inspect --format='{{.State.Status}}' "emeltec-db" 2>/dev/null || echo "unknown")
  if [[ "$db_status" != "running" ]]; then
    log "SKIP flow $key: emeltec-db no está running"
    return
  fi

  local min_raw min last_ts
  min_raw=$(docker exec emeltec-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -t -c "$min_query" 2>/dev/null | tr -d ' \n\r') || true
  [[ -z "${min_raw:-}" || "$min_raw" == "NULL" ]] && min_raw=9999
  min=$(printf '%.0f' "$min_raw" 2>/dev/null || echo 9999)

  last_ts=$(docker exec emeltec-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -t -c "$last_query" 2>/dev/null | tr -d '\n\r' | xargs 2>/dev/null || echo "—")
  [[ -z "${last_ts:-}" ]] && last_ts="Sin datos registrados"

  local level="ok"
  if   [[ "$min" -ge "$RED_MIN" ]];    then level="red"
  elif [[ "$min" -ge "$YELLOW_MIN" ]]; then level="yellow"
  fi

  log "FLOW $key: ${min}m (level=$level, prev=$prev, último=$last_ts)"

  if [[ "$level" == "red" && "$prev" != "red" ]]; then
    set_state "$state_key" "red"
    local rows
    rows=$(make_rows "Consumer" "$label" "Sin datos hace" "${min} minutos" \
                     "Último dato" "$last_ts" "Container" "$container")
    local inner
    inner=$(info_block "$rows")
    inner+=$(note_box "#FEF2F2" "#FECACA" "#DC2626" \
      "Revisar el container <strong>$container</strong> y la conectividad de red.")
    send_email "🔴 [CRÍTICO] $label — sin datos ${min} min" \
      "$label sin datos hace ${min} minutos. Último dato: $last_ts" \
      "$(make_html '#dc2626' '🔴' "CRÍTICO: $label sin datos" "$inner")"

  elif [[ "$level" == "yellow" && "$prev" == "ok" ]]; then
    set_state "$state_key" "yellow"
    local eta=$(( RED_MIN - min ))
    local rows
    rows=$(make_rows "Consumer" "$label" "Sin datos hace" "${min} minutos" \
                     "Último dato" "$last_ts" "Alerta crítica en" "${eta} minutos")
    local inner
    inner=$(info_block "$rows")
    inner+=$(note_box "#FFFBEB" "#FDE68A" "#92400E" \
      "Si no se reanuda la transmisión en ${eta} minutos, se enviará alerta crítica.")
    send_email "⚠️ [ALERTA] $label — sin datos ${min} min" \
      "$label sin datos hace ${min} minutos. Último dato: $last_ts" \
      "$(make_html '#d97706' '⚠️' "Alerta: $label sin datos" "$inner")"

  elif [[ "$level" == "ok" && ( "$prev" == "red" || "$prev" == "yellow" ) ]]; then
    set_state "$state_key" "ok"
    local rows
    rows=$(make_rows "Consumer" "$label" "Estado" "Datos fluyendo normalmente" \
                     "Último dato" "$last_ts" "Recuperado" "$(date '+%d/%m/%Y %H:%M:%S')")
    send_email "✅ [RECUPERADO] $label — datos fluyendo" \
      "$label recuperado. Datos fluyendo. Último dato: $last_ts" \
      "$(make_html '#16a34a' '✅' "$label — datos fluyendo" "$(info_block "$rows")")"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
log "=== Monitor Emeltec — inicio ==="

for c in "${CONTAINERS[@]}"; do
  check_container "$c"
done

check_flow "csv" "csvconsumer (gRPC pipeline)" "emeltec-csvconsumer" \
  "SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM (NOW() - MAX(received_at)))/60)::int, 9999)
   FROM equipo WHERE received_at IS NOT NULL;" \
  "SELECT COALESCE(to_char(MAX(received_at), 'DD/MM/YYYY HH24:MI'), 'Sin datos')
   FROM equipo WHERE received_at IS NOT NULL;"

check_flow "ftp" "ftpconsumer (FTP pipeline)" "emeltec-ftpconsumer" \
  "SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM (NOW() - MAX(time)))/60)::int, 9999)
   FROM equipo WHERE received_at IS NULL;" \
  "SELECT COALESCE(to_char(MAX(time), 'DD/MM/YYYY HH24:MI'), 'Sin datos')
   FROM equipo WHERE received_at IS NULL;"

log "=== Monitor Emeltec — fin ==="
