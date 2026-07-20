#!/usr/bin/env bash
# Security audit — Emeltec3
# Scans: npm/pnpm, cargo, govulncheck, secrets, Docker, nginx, code patterns
# Output: security-audit-YYYY-MM-DD.xlsx in project root
#
# Usage: bash scripts/security-audit.sh
# Or:    pnpm security:audit
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATE=$(date +"%Y-%m-%d")
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
AUDIT_DIR="/tmp/emeltec-audit-${TIMESTAMP}"
REPORT_OUT="$PROJECT_ROOT/security-audit-${DATE}.xlsx"

mkdir -p "$AUDIT_DIR"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
warn() { echo "[$(date '+%H:%M:%S')] WARN: $*" >&2; }
skip() { echo "[$(date '+%H:%M:%S')] SKIP: $*"; }

# ── 1. NPM / PNPM Audit ──────────────────────────────────────────────
log "=== [1/6] Dependency audit — Node.js ==="

declare -a NPM_SERVICES=("." "auth-api" "main-api" "dga-api" "frontend-angular" "metrics-page" "shared")

for svc in "${NPM_SERVICES[@]}"; do
  svc_path="$PROJECT_ROOT/$svc"
  [ -f "$svc_path/package.json" ] || continue

  svc_name=$([ "$svc" = "." ] && echo "root" || echo "${svc//\//-}")
  out="$AUDIT_DIR/npm-${svc_name}.json"

  log "  npm audit: $svc_name"
  if [ -f "$svc_path/pnpm-lock.yaml" ] || ( [ "$svc" = "." ] && [ -f "$PROJECT_ROOT/pnpm-lock.yaml" ] ); then
    (cd "$svc_path" && pnpm audit --json 2>/dev/null || true) > "$out"
  else
    (cd "$svc_path" && npm audit --json 2>/dev/null || true) > "$out"
  fi

  # Validate JSON — reset to empty object on parse error
  node -e "JSON.parse(require('fs').readFileSync('$out','utf8'))" 2>/dev/null \
    || echo '{}' > "$out"
done

# ── 2. Cargo Audit ───────────────────────────────────────────────────
log "=== [2/6] Dependency audit — Rust ==="

if command -v cargo >/dev/null 2>&1; then
  if ! command -v cargo-audit >/dev/null 2>&1; then
    log "  Installing cargo-audit..."
    cargo install cargo-audit --quiet 2>/dev/null || warn "cargo-audit install failed — skipping Rust audit"
  fi

  declare -a RUST_SERVICES=("linux-db-api" "ftp-pipeline/ftpconsumer-rust" "grpc-pipeline/csvconsumer-rust")

  for svc in "${RUST_SERVICES[@]}"; do
    svc_path="$PROJECT_ROOT/$svc"
    [ -f "$svc_path/Cargo.toml" ] || continue

    svc_name="${svc//\//-}"
    log "  cargo audit: $svc_name"
    (cd "$svc_path" && cargo audit --json 2>/dev/null || true) > "$AUDIT_DIR/cargo-${svc_name}.json"
  done
else
  skip "cargo not found — skipping Rust audit"
fi

# ── 3. Go Vulnerability Check ────────────────────────────────────────
log "=== [3/6] Dependency audit — Go ==="

if command -v go >/dev/null 2>&1; then
  if ! command -v govulncheck >/dev/null 2>&1; then
    log "  Installing govulncheck..."
    go install golang.org/x/vuln/cmd/govulncheck@latest 2>/dev/null || warn "govulncheck install failed — skipping Go audit"
  fi

  declare -a GO_MODULES=("grpc-pipeline" "ftp-pipeline/ftpprocessor" "fts-pipeline/ftsprocessor")

  for mod in "${GO_MODULES[@]}"; do
    mod_path="$PROJECT_ROOT/$mod"
    [ -f "$mod_path/go.mod" ] || continue

    mod_name="${mod//\//-}"
    log "  govulncheck: $mod_name"
    (cd "$mod_path" && govulncheck -json ./... 2>/dev/null || true) > "$AUDIT_DIR/go-${mod_name}.ndjson"
  done
else
  skip "go not found — skipping Go audit"
fi

# ── 4. Secret / Credential Scan ──────────────────────────────────────
log "=== [4/6] Secret scan ==="

SECRET_FILE="$AUDIT_DIR/secrets.txt"
> "$SECRET_FILE"

# Scan .env files explicitly (they have no extension so glob excludes miss them)
ENV_FILE="$AUDIT_DIR/env-scan.txt"
> "$ENV_FILE"

find "$PROJECT_ROOT" -name ".env" \
  -not -path "*/.git/*" \
  -not -path "*/node_modules/*" \
  -not -path "*/target/*" | while IFS= read -r envfile; do
  rel="${envfile#"$PROJECT_ROOT/"}"
  # Flag lines with actual values (not empty, not comments, not placeholders)
  grep -nE '^[A-Z_]+=.{4,}' "$envfile" 2>/dev/null | \
    grep -viE '(CHANGE_ME|your_|example|localhost|127\.0\.0\.1|false|true|[0-9]+$)' | \
    while IFS= read -r line; do
      key=$(echo "$line" | cut -d= -f1 | sed 's/^[0-9]*://')
      echo "ENV_VALUE|$rel|$key has a real value — verify it is not committed"
    done >> "$ENV_FILE"
done

count=$(wc -l < "$ENV_FILE" | tr -d ' ')
log "  .env files scanned — $count variables with real values found"

GREP_EXCLUDE=(
  --exclude-dir=node_modules
  --exclude-dir=.git
  --exclude-dir=vendor
  --exclude-dir=target
  --exclude-dir=dist
  --exclude-dir=build
  --exclude-dir=.angular
  --exclude="*.example"
  --exclude="*.md"
  --exclude="*.lock"
  --exclude="pnpm-lock.yaml"
  --exclude="*.sum"
  --exclude="security-audit-*.xlsx"
  --exclude="security-audit.sh"
  --exclude="security-report.mjs"
)

declare -a SECRET_PATTERNS=(
  'password\s*[:=]\s*["'"'"'][^"'"'"']{4,}["'"'"']'
  'secret\s*[:=]\s*["'"'"'][^"'"'"']{4,}["'"'"']'
  'api[_-]?key\s*[:=]\s*["'"'"'][^"'"'"']{8,}["'"'"']'
  'private[_-]?key\s*[:=]\s*["'"'"'][^"'"'"']{8,}["'"'"']'
  'jwt[_-]?secret\s*[:=]\s*["'"'"'][^"'"'"']{4,}["'"'"']'
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
  'AKIA[0-9A-Z]{16}'
  'ghp_[0-9a-zA-Z]{36}'
)

for pattern in "${SECRET_PATTERNS[@]}"; do
  grep -rniE "${GREP_EXCLUDE[@]}" "$pattern" "$PROJECT_ROOT" 2>/dev/null >> "$SECRET_FILE" || true
done

count=$(wc -l < "$SECRET_FILE" | tr -d ' ')
log "  Found $count potential secret matches"

# ── 5. Docker Security ───────────────────────────────────────────────
log "=== [5/6] Docker security check ==="

DOCKER_FILE="$AUDIT_DIR/docker.txt"
> "$DOCKER_FILE"

while IFS= read -r df; do
  rel="${df#"$PROJECT_ROOT/"}"

  if ! grep -q "^USER " "$df"; then
    echo "ROOT_USER|$rel|No USER instruction — container runs as root" >> "$DOCKER_FILE"
  fi

  if grep -qiE "^ENV[[:space:]]+(PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL)" "$df"; then
    match=$(grep -iE "^ENV[[:space:]]+(PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL)" "$df" | head -1 | sed 's/|/,/g')
    echo "ENV_SECRET|$rel|Secret possibly hardcoded in ENV: $match" >> "$DOCKER_FILE"
  fi

  if grep -qiE "^ARG[[:space:]]+(PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL)" "$df"; then
    echo "ARG_SECRET|$rel|Secret passed via ARG (visible in image layers)" >> "$DOCKER_FILE"
  fi

  if grep -qE "^FROM [^:]+:latest" "$df"; then
    echo "LATEST_TAG|$rel|Uses :latest tag — non-deterministic builds" >> "$DOCKER_FILE"
  fi

  if grep -qE "^ADD " "$df"; then
    echo "ADD_USED|$rel|ADD instruction used — prefer COPY (ADD auto-extracts tarballs)" >> "$DOCKER_FILE"
  fi
done < <(find "$PROJECT_ROOT" -name "Dockerfile*" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/target/*" \
  -not -path "*/dist/*")

count=$(wc -l < "$DOCKER_FILE" | tr -d ' ')
log "  Found $count Docker issues"

# ── 6. Nginx Security Headers ────────────────────────────────────────
log "=== [6/6] nginx security headers ==="

NGINX_FILE="$AUDIT_DIR/nginx.txt"
> "$NGINX_FILE"

declare -a REQUIRED_HEADERS=(
  "X-Frame-Options"
  "X-Content-Type-Options"
  "Content-Security-Policy"
  "Strict-Transport-Security"
  "Referrer-Policy"
  "Permissions-Policy"
)

while IFS= read -r conf; do
  rel="${conf#"$PROJECT_ROOT/"}"
  for header in "${REQUIRED_HEADERS[@]}"; do
    if ! grep -qi "$header" "$conf"; then
      echo "MISSING_HEADER|$rel|Missing security header: $header" >> "$NGINX_FILE"
    fi
  done
done < <(find "$PROJECT_ROOT" -name "*.conf" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*")

# ── Code Pattern Scan ────────────────────────────────────────────────
CODE_FILE="$AUDIT_DIR/code-patterns.txt"
> "$CODE_FILE"

JS_EXCLUDE=(
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=.git
  --exclude-dir=.angular
  --exclude-dir=build
)

# Dangerous JS/TS patterns
declare -A JS_PATTERNS
JS_PATTERNS['eval\(']="eval() — arbitrary code execution"
JS_PATTERNS['dangerouslySetInnerHTML']="dangerouslySetInnerHTML — XSS risk"
JS_PATTERNS['document\.write\(']="document.write() — XSS risk"
JS_PATTERNS['innerHTML\s*=(?!=)']="innerHTML assignment — potential XSS"
JS_PATTERNS['setTimeout\s*\(\s*["\x27]']="setTimeout with string — eval equivalent"

for pattern in "${!JS_PATTERNS[@]}"; do
  desc="${JS_PATTERNS[$pattern]}"
  grep -rniE "${JS_EXCLUDE[@]}" \
    --include="*.ts" --include="*.js" --include="*.tsx" \
    "$pattern" "$PROJECT_ROOT" 2>/dev/null | while IFS= read -r match; do
    echo "JS_PATTERN|${match//|/,}|$desc"
  done >> "$CODE_FILE" || true
done

# SQL injection via template literals in JS/TS
grep -rniE "${JS_EXCLUDE[@]}" \
  --include="*.ts" --include="*.js" \
  '`[^`]*(SELECT|INSERT|UPDATE|DELETE|DROP TABLE|TRUNCATE)[^`]*\$\{' \
  "$PROJECT_ROOT" 2>/dev/null | while IFS= read -r match; do
  echo "SQL_INJECT|${match//|/,}|SQL query built with template literal — injection risk"
done >> "$CODE_FILE" || true

# SQL injection via fmt.Sprintf in Go
grep -rniE --exclude-dir=vendor --exclude-dir=.git \
  --include="*.go" \
  'fmt\.Sprintf\s*\(\s*"[^"]*(SELECT|INSERT|UPDATE|DELETE)' \
  "$PROJECT_ROOT" 2>/dev/null | while IFS= read -r match; do
  echo "SQL_INJECT_GO|${match//|/,}|SQL built with fmt.Sprintf — injection risk"
done >> "$CODE_FILE" || true

count=$(wc -l < "$CODE_FILE" | tr -d ' ')
log "  Found $count code pattern issues"

# ── Generate Excel Report ─────────────────────────────────────────────
log ""
log "Generating Excel report..."
echo "$AUDIT_DIR" > /tmp/emeltec-audit-latest.txt

node "$SCRIPT_DIR/security-report.mjs" "$AUDIT_DIR" "$REPORT_OUT"

log ""
log "✓ Report saved: $REPORT_OUT"
log "  Raw data:     $AUDIT_DIR"
