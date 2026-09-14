#!/usr/bin/env bash
# scripts/monitor.sh — Emeltec infrastructure health monitor
# Deploy: systemd service en loop continuo, NO cron (ver scripts/emeltec-monitor.service)
#   Instala con: sudo cp scripts/emeltec-monitor.service /etc/systemd/system/
#                sudo systemctl daemon-reload && sudo systemctl enable --now emeltec-monitor.service
#   El servicio corre este script en un loop con sleep entre corridas (ver LOOP_SLEEP_SEC ahí) —
#   antes corría por cron cada 5 min, ahora el delay de alerta baja a ~segundos.
# Setup una vez: mkdir -p /home/azureuser/emeltec3/logs  (azureuser no tiene permiso de escritura en /var/log)
# Rotación: /etc/logrotate.d/emeltec-monitor -> /home/azureuser/emeltec3/logs/monitor.log { daily rotate 7 compress delaycompress missingok notifempty su azureuser azureuser }
# Requiere: jq (para armar el JSON del email — ya NO depende de node)

set -Eeuo pipefail

LOCK_FILE="/tmp/emeltec-monitor.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "[$(date '+%Y-%m-%d %H:%M:%S')] SKIP: corrida anterior aún activa"; exit 0; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"
STATE_DIR="/tmp/emeltec-monitor"
YELLOW_MIN=5
RED_MIN=10

TO_EMAILS=("mcid@emeltec.cl" "nlira@emeltec.cl" "druiz@emeltec.cl")

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

if [[ ! -f "$ENV_FILE" ]]; then
  log "WARN: $ENV_FILE no encontrado, usando valores por defecto"
fi

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

# ── Logo (mismo asset que usa main-api/src/services/emailService.js) ──────────
LOGO_CID="emeltec-logo"
LOGO_CANDIDATES=(
  "${EMAIL_LOGO_PATH:-}"
  "$(dirname "$SCRIPT_DIR")/main-api/assets/emeltec-logo.png"
  "$(dirname "$SCRIPT_DIR")/frontend-angular/public/images/emeltec-logo.png"
)
LOGO_B64=""
for candidate in "${LOGO_CANDIDATES[@]}"; do
  [[ -z "$candidate" || ! -f "$candidate" ]] && continue
  LOGO_B64=$(base64 -w0 "$candidate" 2>/dev/null) && { log "Logo cargado desde $candidate"; break; }
done
[[ -z "$LOGO_B64" ]] && log "WARN: logo no encontrado en candidatos (${LOGO_CANDIDATES[*]})"

# ── State ─────────────────────────────────────────────────────────────────────
# One file per alert key — contains: ok / yellow / red / down / missing
get_state() { cat "${STATE_DIR}/${1}" 2>/dev/null || echo "ok"; }
set_state()  { printf '%s' "$2" > "${STATE_DIR}/${1}"; }

# ── HTML builders (mismo sistema visual que main-api/src/services/emailService.js) ──
escape_html() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

# Gradientes de marca por color de acento (igual que SEVERIDAD_GRADIENT en emailService.js)
gradient_for() {
  case "$1" in
    '#dc2626') echo 'linear-gradient(90deg,#dc2626 0%,#7f1d1d 100%)' ;;
    '#d97706') echo 'linear-gradient(90deg,#d97706 0%,#92400e 100%)' ;;
    '#22C55E'|'#16a34a') echo 'linear-gradient(90deg,#22C55E 0%,#15803D 100%)' ;;
    '#0DAFBD') echo 'linear-gradient(90deg,#0DAFBD 0%,#04606A 100%)' ;;
    *) echo "linear-gradient(90deg,$1 0%,$1 100%)" ;;
  esac
}

make_rows() {
  local out="" safe1 safe2
  while [[ $# -ge 2 ]]; do
    safe1=$(escape_html "$1")
    safe2=$(escape_html "$2")
    out+="<tr>"
    out+="<td style='padding:11px 16px;border-bottom:1px solid #E2E8F0;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;width:38%;vertical-align:top;'>$safe1</td>"
    out+="<td style='padding:11px 16px;border-bottom:1px solid #E2E8F0;font-size:14px;color:#1E293B;font-weight:500;vertical-align:top;'>$safe2</td>"
    out+="</tr>"
    shift 2
  done
  echo "$out"
}

make_html() {
  local accent="$1" icon="$2" title="$3" inner="$4"
  local ts gradient logo_row
  ts=$(date '+%d/%m/%Y %H:%M:%S')
  gradient=$(gradient_for "$accent")
  logo_row=""
  if [[ -n "$LOGO_B64" ]]; then
    logo_row="<tr><td style=\"background-color:#FFFFFF;padding:30px 32px 22px;text-align:center;border-bottom:1px solid #E2E8F0;\"><img src=\"cid:${LOGO_CID}\" alt=\"Emeltec\" width=\"220\" height=\"63\" style=\"display:block;margin:0 auto;border:0;outline:none;text-decoration:none;height:63px;width:220px;max-width:220px;\"></td></tr>"
  fi
  cat <<HTML
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F0F2F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1E293B;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0F2F5;padding:32px 16px;">
<tr>
<td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
${logo_row}
<tr>
<td style="padding:0;line-height:0;font-size:0;height:3px;background-color:${accent};background-image:${gradient};">&nbsp;</td>
</tr>
<tr>
<td style="padding:32px 40px 8px;">
<p style="margin:0 0 6px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Monitor de infraestructura</p>
<h1 style="margin:0;font-size:22px;line-height:1.3;color:#1E293B;font-weight:600;letter-spacing:-0.01em;">${icon} ${title}</h1>
</td>
</tr>
<tr>
<td style="padding:16px 40px 32px;">
${inner}
</td>
</tr>
<tr>
<td style="background-color:#F8FAFC;border-top:1px solid #E2E8F0;padding:18px 40px;text-align:center;">
<p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#94A3B8;font-weight:700;">Emeltec Cloud - Emeltec HUB</p>
<p style="margin:6px 0 0;font-size:11px;color:#94A3B8;line-height:1.5;">Monitor automático &middot; ${ts}</p>
</td>
</tr>
</table>
<p style="margin:16px 0 0;font-size:11px;color:#94A3B8;text-align:center;">&copy; $(date '+%Y') Emeltec SpA &middot; Santiago, Chile</p>
</td>
</tr>
</table>
</body>
</html>
HTML
}

info_block() {
  local rows="$1" accent="${2:-#0DAFBD}"
  echo "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0'
             style='background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;border-left:3px solid ${accent};overflow:hidden;margin-bottom:8px;'>
    $rows
  </table>"
}

note_box() {
  local bg="$1" border="$2" color="$3" text="$4"
  echo "<p style='margin:16px 0 0;padding:14px 16px;background-color:${bg};border:1px solid ${border};
                  border-radius:10px;font-size:12px;line-height:1.55;color:${color};'>$text</p>"
}

# ── Email ─────────────────────────────────────────────────────────────────────
send_email() {
  local subject="$1" text_body="$2" html_body="$3"

  if [[ -z "${RESEND_API_KEY:-}" ]]; then
    log "WARN: RESEND_API_KEY vacío — simulando: $subject"
    return 0
  fi

  for email in "${TO_EMAILS[@]}"; do
    # Write content to temp files — avoids argv length limits
    local ts tt th tp tr
    ts=$(mktemp); tt=$(mktemp); th=$(mktemp); tp=$(mktemp); tr=$(mktemp)
    printf '%s' "$subject"   > "$ts"
    printf '%s' "$text_body" > "$tt"
    printf '%s' "$html_body" > "$th"

    jq -n \
      --arg from "$RESEND_FROM" \
      --arg to "$email" \
      --rawfile subject "$ts" \
      --rawfile text "$tt" \
      --rawfile html "$th" \
      --arg logo_b64 "$LOGO_B64" \
      --arg logo_cid "$LOGO_CID" \
      '{from: $from, to: $to, subject: $subject, text: $text, html: $html}
       + (if ($logo_b64 | length) > 0
          then {attachments: [{filename: "emeltec-logo.png", content: $logo_b64, content_type: "image/png", content_id: $logo_cid}]}
          else {} end)' > "$tp"

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

# ── Container check ───────────────────────────────────────────────────────────
declare -a SUMMARY_ROWS=()

check_container() {
  local name="$1"
  local key="c_${name}"
  local prev
  prev=$(get_state "$key")

  if ! timeout 5 docker inspect "$name" >/dev/null 2>&1; then
    SUMMARY_ROWS+=("$name" "no existe")
    [[ "$prev" == "missing" ]] && { log "SKIP $name (ya alertado: missing)"; return; }
    set_state "$key" "missing"
    local rows
    rows=$(make_rows "Container" "$name" "Estado" "No existe en Docker" \
                     "Acción" "Verificar docker-compose")
    local inner
    inner=$(info_block "$rows" '#dc2626')
    inner+=$(note_box "#FEF2F2" "#FECACA" "#DC2626" \
      "El container no existe. Verificar que <code>docker-compose</code> esté levantado.")
    send_email "🔴 [CAÍDO] $name — no encontrado" \
      "Container $name no existe en Docker. $(date)" \
      "$(make_html '#dc2626' '🔴' "Container no encontrado: $name" "$inner")"
    return
  fi

  local status exit_code
  status=$(timeout 5 docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "unknown")
  exit_code=$(timeout 5 docker inspect --format='{{.State.ExitCode}}' "$name" 2>/dev/null || echo "-1")

  if [[ "$status" != "running" ]]; then
    SUMMARY_ROWS+=("$name" "$status (exit $exit_code)")
    [[ "$prev" == "down" ]] && { log "SKIP $name (ya alertado: down)"; return; }
    set_state "$key" "down"

    local raw_logs safe_logs
    raw_logs=$(timeout 5 docker logs --tail 30 "$name" 2>&1 || echo "(sin logs disponibles)")
    safe_logs=$(printf '%s' "$raw_logs" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')

    local rows
    rows=$(make_rows "Container" "$name" "Estado" "$status" "Exit code" "$exit_code")
    local inner
    inner=$(info_block "$rows" '#dc2626')
    inner+="<p style='margin:16px 0 4px;font-size:12px;color:#64748B;'><strong>Últimas líneas de log:</strong></p>"
    inner+="<pre style='background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:10px;
                         font-size:11px;color:#334155;white-space:pre-wrap;overflow-x:auto;'>$safe_logs</pre>"

    send_email "🔴 [CAÍDO] $name — exit $exit_code" \
      "Container $name cayó. Estado: $status. Exit: $exit_code. $(date)" \
      "$(make_html '#dc2626' '🔴' "Container caído: $name" "$inner")"
  else
    SUMMARY_ROWS+=("$name" "running")
    if [[ "$prev" == "down" || "$prev" == "missing" ]]; then
      set_state "$key" "ok"
      local rows
      rows=$(make_rows "Container" "$name" "Estado" "running" \
                       "Recuperado" "$(date '+%d/%m/%Y %H:%M:%S')")
      send_email "✅ [RECUPERADO] $name — running" \
        "Container $name está running nuevamente. $(date)" \
        "$(make_html '#22C55E' '✅' "Container recuperado: $name" "$(info_block "$rows" '#22C55E')")"
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
  db_status=$(timeout 5 docker inspect --format='{{.State.Status}}' "emeltec-db" 2>/dev/null || echo "unknown")
  if [[ "$db_status" != "running" ]]; then
    log "SKIP flow $key: emeltec-db no está running"
    return
  fi

  local min_raw min last_ts
  min_raw=$(timeout 5 docker exec emeltec-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -t -c "$min_query" 2>/dev/null | tr -d ' \n\r') || true
  [[ -z "${min_raw:-}" || "$min_raw" == "NULL" ]] && min_raw=9999
  min=$(printf '%.0f' "$min_raw" 2>/dev/null || echo 9999)

  last_ts=$(timeout 5 docker exec emeltec-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -t -c "$last_query" 2>/dev/null | tr -d '\n\r' | xargs 2>/dev/null || echo "—")
  [[ -z "${last_ts:-}" ]] && last_ts="Sin datos registrados"

  local level="ok"
  if   [[ "$min" -ge "$RED_MIN" ]];    then level="red"
  elif [[ "$min" -ge "$YELLOW_MIN" ]]; then level="yellow"
  fi

  log "FLOW $key: ${min}m (level=$level, prev=$prev, último=$last_ts)"
  SUMMARY_ROWS+=("$label" "$([[ "$level" == "ok" ]] && echo "datos OK ($last_ts)" || echo "sin datos hace ${min} min ($level)")")

  if [[ "$level" == "red" && "$prev" != "red" ]]; then
    set_state "$state_key" "red"
    local rows
    rows=$(make_rows "Consumer" "$label" "Sin datos hace" "${min} minutos" \
                     "Último dato" "$last_ts" "Container" "$container")
    local inner
    inner=$(info_block "$rows" '#dc2626')
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
    inner=$(info_block "$rows" '#d97706')
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
      "$(make_html '#22C55E' '✅' "$label — datos fluyendo" "$(info_block "$rows" '#22C55E')")"
  fi
}

# ── Detección de reinicio (VM caída y vuelta) ──────────────────────────────────
# STATE_DIR vive en /tmp, que se limpia en cada boot de Ubuntu — la ausencia
# del heartbeat de la corrida anterior, o un hueco grande entre corridas
# (mucho más que el intervalo del loop systemd), es la señal de que la VM se reinició.
MONITOR_HEARTBEAT="$STATE_DIR/monitor-last-run"
RESTART_GAP_SECONDS=180  # 3 min — margen amplio para el loop systemd (corre cada ~20s), evita falsos positivos
NOW_EPOCH=$(date +%s)
LAST_RUN_EPOCH=$(cat "$MONITOR_HEARTBEAT" 2>/dev/null || echo "")

RESTART_DETECTED=0
RESTART_REASON=""

if [[ -z "$LAST_RUN_EPOCH" ]]; then
  RESTART_DETECTED=1
  RESTART_REASON="Sin heartbeat de la corrida anterior (perdido por reinicio de VM o primera corrida de monitor.sh)."
elif [[ ! "$LAST_RUN_EPOCH" =~ ^[0-9]+$ ]]; then
  RESTART_DETECTED=1
  RESTART_REASON="Heartbeat de la corrida anterior corrupto (contenido no numérico) — tratado como reinicio."
else
  GAP=$(( NOW_EPOCH - LAST_RUN_EPOCH ))
  if (( GAP > RESTART_GAP_SECONDS )); then
    RESTART_DETECTED=1
    GAP_MIN=$(( GAP / 60 ))
    RESTART_REASON="monitor.sh no corrió por ${GAP_MIN} min (última corrida: $(date -d "@$LAST_RUN_EPOCH" '+%d/%m/%Y %H:%M:%S' 2>/dev/null || echo "epoch $LAST_RUN_EPOCH"))."
  fi
fi

if [[ "$RESTART_DETECTED" -eq 1 ]]; then
  BOOT_STR=$(uptime -s 2>/dev/null || echo "")
  if [[ -n "$BOOT_STR" ]]; then
    BOOT_EPOCH=$(date -d "$BOOT_STR" +%s 2>/dev/null || echo 0)
    if [[ "$BOOT_EPOCH" -gt 0 ]]; then
      UPTIME_MIN=$(( (NOW_EPOCH - BOOT_EPOCH) / 60 ))
      if (( UPTIME_MIN < 20 )); then
        RESTART_REASON="$RESTART_REASON VM reinició hace ${UPTIME_MIN} min (boot: $BOOT_STR)."
      fi
    fi
  fi
fi

# ── Main ──────────────────────────────────────────────────────────────────────
log "=== Monitor Emeltec — inicio ==="
[[ "$RESTART_DETECTED" -eq 1 ]] && log "REINICIO DETECTADO: $RESTART_REASON"

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

# ── Email de reinicio: resumen inmediato con el estado de todo + la razón ─────
if [[ "$RESTART_DETECTED" -eq 1 ]]; then
  rows=$(make_rows "${SUMMARY_ROWS[@]}")
  inner=$(info_block "$rows" '#0DAFBD')
  inner+=$(note_box "#F0FBFC" "rgba(13,175,189,0.35)" "#04606A" "$RESTART_REASON")
  send_email "🔵 [MONITOR] monitor.sh arrancó — resumen de estado" \
    "monitor.sh volvió a correr. $RESTART_REASON" \
    "$(make_html '#0DAFBD' '🔵' 'Monitor arrancó — resumen de estado' "$inner")"
fi

printf '%s' "$NOW_EPOCH" > "$MONITOR_HEARTBEAT"

log "=== Monitor Emeltec — fin ==="
