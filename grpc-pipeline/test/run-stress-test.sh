#!/usr/bin/env bash
# Test destructivo de csvconsumer.
# Intenta romper el sistema con fallos reales: Postgres caído, restart, duplicados,
# datos malformados, bulk mode, envíos concurrentes.
#
# Uso: bash grpc-pipeline/test/run-stress-test.sh (desde raíz del repo)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="$(realpath "$SCRIPT_DIR/../proto")"
PASS=0
FAIL=0

green()  { echo -e "\033[32m✅ $*\033[0m"; }
red()    { echo -e "\033[31m❌ $*\033[0m"; }
yellow() { echo -e "\033[33m⚠️  $*\033[0m"; }
title()  { echo -e "\n\033[1m=== $* ===\033[0m"; }

# grpcurl: flags → host:port → method
# Uso: grpc <method> [-d '{...}']
grpc() {
  local method="$1"; shift
  MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$PROTO_DIR:/proto" \
    fullstorydev/grpcurl:latest \
    -plaintext \
    -import-path /proto \
    -proto logpipeline.proto \
    "$@" \
    host.docker.internal:50052 \
    "$method" 2>&1
}

check() {
  local desc="$1"; local expected="$2"; local actual="$3"
  if echo "$actual" | grep -qE "$expected"; then
    green "$desc"
    PASS=$((PASS+1))
  else
    red "$desc (esperado: '$expected')"
    echo "    got: $actual"
    FAIL=$((FAIL+1))
  fi
}

count_rows() {
  docker exec csvconsumer-test-db psql -U admin_test -d db_test -tAc \
    "SELECT COUNT(*) FROM equipo;" 2>/dev/null | tr -d ' \n'
}

# ── Arranque ──────────────────────────────────────────────────────────────────
title "0. Arranque limpio"
docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" down -v 2>/dev/null || true
docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" up --build -d || { red "Falló arranque de servicios"; exit 1; }

for i in $(seq 1 30); do
  if docker logs csvconsumer-test-app 2>&1 | grep -q "csvconsumer puerto="; then
    green "csvconsumer listo"; break
  fi
  sleep 1
done

# ── Test 1: Ping ──────────────────────────────────────────────────────────────
title "1. Ping básico"
result=$(grpc logpipeline.LogIngestion/Ping)
check "Ping responde ok" '"ok"' "$result"

# ── Test 2: Lote normal ───────────────────────────────────────────────────────
title "2. Lote normal (3 registros)"
result=$(grpc logpipeline.LogIngestion/SendRecords -d '{
  "filename": "normal.csv",
  "records": [
    {"id_serial":"A001","fecha":"2026-01-01","hora":"00:00:00","data":"{\"v\":1}"},
    {"id_serial":"A001","fecha":"2026-01-01","hora":"00:01:00","data":"{\"v\":2}"},
    {"id_serial":"A001","fecha":"2026-01-01","hora":"00:02:00","data":"{\"v\":3}"}
  ]
}')
check "ACK inmediato con inserted=3" '"inserted": 3' "$result"
sleep 5
rows=$(count_rows)
check "3 filas en PostgreSQL" "^3$" "$rows"

# ── Test 3: Lote vacío ────────────────────────────────────────────────────────
title "3. Lote vacío"
result=$(grpc logpipeline.LogIngestion/SendRecords -d '{"filename":"empty.csv","records":[]}')
check "Responde ok con lote vacío" '"ok": true' "$result"
check "Mensaje describe lote vacío" 'no contiene registros' "$result"

# ── Test 4: Registro malformado — id_serial vacío ─────────────────────────────
title "4. Registro malformado — id_serial vacío"
result=$(grpc logpipeline.LogIngestion/SendRecords -d '{
  "filename": "bad.csv",
  "records": [{"id_serial":"","fecha":"2026-01-01","hora":"00:00:00","data":"{\"v\":9}"}]
}')
check "Rechaza id_serial vacío" 'sin id_serial' "$result"
sleep 4
rows=$(count_rows)
check "Sin filas extra (sigue en 3)" "^3$" "$rows"

# ── Test 5: Registro malformado — fecha vacía ─────────────────────────────────
title "5. Registro malformado — fecha vacía"
result=$(grpc logpipeline.LogIngestion/SendRecords -d '{
  "filename": "bad2.csv",
  "records": [{"id_serial":"X","fecha":"","hora":"00:00:00","data":"{\"v\":9}"}]
}')
check "Rechaza fecha vacía" 'sin fecha' "$result"

# ── Test 6: Bulk mode (>10 registros en cola) ─────────────────────────────────
title "6. Bulk mode — 20 registros de una vez"
records=""
for i in $(seq 1 20); do
  m=$(printf "%02d" $i)
  records="${records}{\"id_serial\":\"BULK01\",\"fecha\":\"2026-02-01\",\"hora\":\"10:${m}:00\",\"data\":\"{\\\"n\\\":${i}}\"},"
done
records="[${records%,}]"

result=$(grpc logpipeline.LogIngestion/SendRecords -d "{\"filename\":\"bulk.csv\",\"records\":$records}")
check "Bulk encolado modo bulk" 'bulk' "$result"
sleep 6
rows=$(count_rows)
check "23 filas totales (3 + 20 bulk)" "^23$" "$rows"

# ── Test 7: Crash de PostgreSQL y reconexión ──────────────────────────────────
title "7. PostgreSQL se cae — reconexión automática"
yellow "Deteniendo PostgreSQL..."
docker stop csvconsumer-test-db

result=$(grpc logpipeline.LogIngestion/SendRecords -d '{
  "filename": "offline.csv",
  "records": [
    {"id_serial":"CRASH01","fecha":"2026-03-01","hora":"10:00:00","data":"{\"crash\":true}"},
    {"id_serial":"CRASH01","fecha":"2026-03-01","hora":"10:01:00","data":"{\"crash\":true}"}
  ]
}')
check "ACK aunque Postgres está caído (WAL guarda)" '"ok": true' "$result"

sleep 3
yellow "Reiniciando PostgreSQL..."
docker start csvconsumer-test-db
sleep 10  # esperar healthcheck + reconnect + flush

rows=$(count_rows)
check "25 filas (23 + 2 de crash)" "^25$" "$rows"

# ── Test 8: Reinicio de csvconsumer (recovery WAL) ───────────────────────────
title "8. csvconsumer se reinicia — WAL recovery"
grpc logpipeline.LogIngestion/SendRecords -d '{
  "filename": "pre-restart.csv",
  "records": [
    {"id_serial":"RESTART01","fecha":"2026-04-01","hora":"09:00:00","data":"{\"r\":1}"},
    {"id_serial":"RESTART01","fecha":"2026-04-01","hora":"09:01:00","data":"{\"r\":2}"},
    {"id_serial":"RESTART01","fecha":"2026-04-01","hora":"09:02:00","data":"{\"r\":3}"}
  ]
}' > /dev/null

yellow "Matando csvconsumer (SIGKILL — flush no puede correr)..."
docker kill csvconsumer-test-app > /dev/null
docker start csvconsumer-test-app > /dev/null

for i in $(seq 1 20); do
  if docker logs csvconsumer-test-app 2>&1 | grep -q "csvconsumer puerto="; then break; fi
  sleep 1
done
sleep 6  # esperar flush tras WAL recovery

rows=$(count_rows)
check "28 filas (25 + 3 recuperadas del WAL)" "^28$" "$rows"

wrecov=$(docker logs csvconsumer-test-app 2>&1 | grep "WAL: recuperando" || true)
check "Logs muestran WAL recovery" "recuperando" "$wrecov"

# ── Test 9: Duplicados ────────────────────────────────────────────────────────
title "9. Duplicados — mismo registro dos veces"
grpc logpipeline.LogIngestion/SendRecords -d '{
  "filename": "dup.csv",
  "records": [
    {"id_serial":"A001","fecha":"2026-01-01","hora":"00:00:00","data":"{\"v\":1}"}
  ]
}' > /dev/null
sleep 5
rows=$(count_rows)
yellow "Duplicados: filas actuales = $rows"
check "Filas ≤29 (duplicado no se duplica en DB)" "^2[89]$" "$rows"

# ── Test 10: Envíos concurrentes ──────────────────────────────────────────────
title "10. Envíos concurrentes — 5 lotes en paralelo"
for i in $(seq 1 5); do
  grpc logpipeline.LogIngestion/SendRecords -d "{
    \"filename\": \"concurrent_${i}.csv\",
    \"records\": [
      {\"id_serial\":\"CONC0${i}\",\"fecha\":\"2026-05-0${i}\",\"hora\":\"00:00:00\",\"data\":\"{\\\"c\\\":${i}}\"},
      {\"id_serial\":\"CONC0${i}\",\"fecha\":\"2026-05-0${i}\",\"hora\":\"00:01:00\",\"data\":\"{\\\"c\\\":${i}}\"}
    ]
  }" > /dev/null &
done
wait
sleep 6
rows=$(count_rows)
check "Total ≥38 tras concurrentes" "^[3-9][0-9]$|^[4-9][0-9]$" "$rows"

# ── Resumen ───────────────────────────────────────────────────────────────────
title "RESUMEN"
echo "Filas finales en PostgreSQL: $(count_rows)"
echo ""
echo "Logs csvconsumer (últimas 20 líneas):"
docker logs csvconsumer-test-app 2>&1 | tail -20
echo ""
green "PASSED: $PASS"
if [ $FAIL -gt 0 ]; then
  red "FAILED: $FAIL"
else
  green "FAILED: 0 — todos los tests pasaron"
fi

echo ""
echo "Para limpiar: docker compose -f $SCRIPT_DIR/docker-compose.test.yml down -v"
