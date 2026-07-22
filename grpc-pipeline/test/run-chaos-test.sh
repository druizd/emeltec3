#!/usr/bin/env bash
# Chaos test — destrucción total de csvconsumer.
# Bulk mode, 10 senders simultáneos, SIGKILLs en cadena,
# 3 crashes de PostgreSQL seguidos, datos inválidos en masa,
# y caos total (SIGKILL + crash Postgres simultáneos).
#
# Uso: bash grpc-pipeline/test/run-chaos-test.sh (desde raíz del repo)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="$(realpath "$SCRIPT_DIR/../proto")"
PASS=0
FAIL=0
STARTS=0

green()  { echo -e "\033[32m✅ $*\033[0m"; }
red()    { echo -e "\033[31m❌ $*\033[0m"; }
yellow() { echo -e "\033[33m⚠️  $*\033[0m"; }
title()  { echo -e "\n\033[1;35m════ $* ════\033[0m"; }

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
    red "$desc"
    echo "    esperado: '$expected'"
    echo "    got:      $actual"
    FAIL=$((FAIL+1))
  fi
}

check_gte() {
  local desc="$1"; local min="$2"; local actual="$3"
  if [ "$actual" -ge "$min" ] 2>/dev/null; then
    green "$desc ($actual)"
    PASS=$((PASS+1))
  else
    red "$desc (got=$actual esperado≥$min)"
    FAIL=$((FAIL+1))
  fi
}

check_eq() {
  local desc="$1"; local expected="$2"; local actual="$3"
  if [ "$actual" -eq "$expected" ] 2>/dev/null; then
    green "$desc ($actual)"
    PASS=$((PASS+1))
  else
    red "$desc (got=$actual esperado=$expected)"
    FAIL=$((FAIL+1))
  fi
}

count_rows() {
  docker exec csvconsumer-test-db psql -U admin_test -d db_test -tAc \
    "SELECT COUNT(*) FROM equipo;" 2>/dev/null | tr -d ' \n'
}

app_logs() {
  docker logs csvconsumer-test-app 2>&1
}

wal_recoveries() {
  app_logs | grep "WAL: recuperando" | wc -l | tr -d ' '
}

wait_app_ready() {
  local expected_starts="$1"
  for i in $(seq 1 40); do
    local n
    n=$(app_logs | grep -c "csvconsumer puerto=" 2>/dev/null || echo 0)
    if [ "$n" -ge "$expected_starts" ] 2>/dev/null; then return 0; fi
    sleep 1
  done
  red "Timeout esperando arranque #$expected_starts"
  return 1
}

# Genera N registros inline como array JSON (max ~50 para evitar ARG_MAX)
make_batch() {
  local prefix="$1"; local date="$2"; local count="$3"
  local out=""
  for j in $(seq 1 "$count"); do
    local h m
    h=$(printf "%02d" $((j % 24)))
    m=$(printf "%02d" $((j % 60)))
    out="${out}{\"id_serial\":\"${prefix}_$(printf '%04d' $j)\",\"fecha\":\"${date}\",\"hora\":\"${h}:${m}:00\",\"data\":\"{\\\"n\\\":${j}}\"},"
  done
  echo "[${out%,}]"
}

# ── Arranque ──────────────────────────────────────────────────────────────────
title "0. Arranque limpio"
docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" down -v 2>/dev/null || true
docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" up --build -d || { red "Falló arranque"; exit 1; }
STARTS=$((STARTS+1))
wait_app_ready $STARTS && green "csvconsumer listo (#$STARTS)"

# ── Test 1: Bulk mode — 50 registros en una llamada ──────────────────────────
title "1. Bulk mode — 50 registros en 1 llamada (BULK_THRESHOLD=10)"
batch=$(make_batch "BULK" "2026-01-15" 50)
result=$(grpc logpipeline.LogIngestion/SendRecords -d "{\"filename\":\"bulk.csv\",\"records\":$batch}")
check "ACK recibió 50 registros" '"inserted": 50' "$result"
check "Modo bulk activado (cola>10)" 'bulk' "$result"
sleep 8
rows_t1=$(count_rows)
check_gte "50 filas en PostgreSQL" 50 "$rows_t1"

# ── Test 2: 10 senders concurrentes × 50 registros ───────────────────────────
title "2. Concurrencia extrema — 10 senders × 50 registros simultáneos (500 total)"
for i in $(seq 1 10); do
  batch=$(make_batch "CONC$(printf '%02d' $i)" "2026-02-$(printf '%02d' $((i % 28 + 1)))" 50)
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"conc_${i}.csv\",\"records\":$batch}" > /dev/null &
done
wait
sleep 12
rows_t2=$(count_rows)
new_t2=$((rows_t2 - rows_t1))
check_gte "500 registros concurrentes insertados" 500 "$new_t2"

# ── Test 3: Crash de PostgreSQL durante carga activa ─────────────────────────
title "3. PostgreSQL cae MIENTRAS 5 senders están activos (200 registros en vuelo)"
for i in $(seq 1 5); do
  batch=$(make_batch "CL$(printf '%02d' $i)" "2026-03-$(printf '%02d' $((i % 28 + 1)))" 40)
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"cl_${i}.csv\",\"records\":$batch}" > /dev/null &
done
sleep 1
yellow "Crash de PostgreSQL durante carga activa..."
docker stop csvconsumer-test-db
wait

sleep 3
yellow "Levantando PostgreSQL..."
docker start csvconsumer-test-db
sleep 15

rows_t3=$(count_rows)
new_t3=$((rows_t3 - rows_t2))
check_gte "WAL protegió ≥200 registros durante crash bajo carga" 200 "$new_t3"

# ── Test 4: 3 SIGKILLs consecutivos — WAL resiste todo ───────────────────────
title "4. 3 SIGKILLs consecutivos — WAL nunca pierde datos (150 registros)"
wal_before=$(wal_recoveries)
for cycle in $(seq 1 3); do
  yellow "SIGKILL ciclo $cycle/3 — enviando 50 registros..."
  batch=$(make_batch "KILL${cycle}" "2026-04-$(printf '%02d' $cycle)" 50)
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"kill_${cycle}.csv\",\"records\":$batch}" > /dev/null

  STARTS=$((STARTS+1))
  docker kill csvconsumer-test-app > /dev/null
  docker start csvconsumer-test-app > /dev/null
  wait_app_ready $STARTS
  sleep 6
done

rows_t4=$(count_rows)
new_t4=$((rows_t4 - rows_t3))
check_gte "150 registros sobrevivieron 3 SIGKILLs" 150 "$new_t4"

wal_after=$(wal_recoveries)
new_recoveries=$((wal_after - wal_before))
check_gte "WAL recovery ocurrió al menos una vez en los kill cycles" 1 "$new_recoveries"

# ── Test 5: PostgreSQL cae 3 veces seguidas ───────────────────────────────────
title "5. PostgreSQL cae 3 veces seguidas — backoff exponencial aguanta (90 registros)"
for crash in $(seq 1 3); do
  yellow "Crash de PostgreSQL $crash/3..."
  docker stop csvconsumer-test-db

  batch=$(make_batch "PG${crash}" "2026-05-$(printf '%02d' $crash)" 30)
  result=$(grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"pgcrash_${crash}.csv\",\"records\":$batch}")
  check "ACK ok con Postgres caído (crash $crash/3)" '"ok": true' "$result"

  docker start csvconsumer-test-db
  sleep 13
done

rows_t5=$(count_rows)
new_t5=$((rows_t5 - rows_t4))
check_gte "90 registros sobrevivieron 3 crashes de PostgreSQL" 90 "$new_t5"

# ── Test 6: 100 requests inválidas simultáneas ────────────────────────────────
title "6. Barrage de datos inválidos — sistema no crashea ni inserta nada"
for i in $(seq 1 25); do
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"bad_a_${i}.csv\",\"records\":[{\"id_serial\":\"\",\"fecha\":\"2026-06-01\",\"hora\":\"00:00:00\",\"data\":\"{}\"}]}" \
    > /dev/null &
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"bad_b_${i}.csv\",\"records\":[{\"id_serial\":\"X\",\"fecha\":\"\",\"hora\":\"00:00:00\",\"data\":\"{}\"}]}" \
    > /dev/null &
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"bad_c_${i}.csv\",\"records\":[{\"id_serial\":\"X\",\"fecha\":\"2026-06-01\",\"hora\":\"\",\"data\":\"{}\"}]}" \
    > /dev/null &
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"bad_d_${i}.csv\",\"records\":[]}" \
    > /dev/null &
done
wait
sleep 5

result=$(grpc logpipeline.LogIngestion/Ping)
check "Sistema sigue vivo tras 100 requests inválidas" '"ok"' "$result"
rows_t6=$(count_rows)
check_eq "Cero filas insertadas por datos inválidos" 0 "$((rows_t6 - rows_t5))"

# ── Test 7: Caos total ────────────────────────────────────────────────────────
title "7. CAOS TOTAL — 8 senders + SIGKILL + crash Postgres simultáneos (320 en vuelo)"
for i in $(seq 1 8); do
  batch=$(make_batch "CHAOS$(printf '%02d' $i)" "2026-07-$(printf '%02d' $((i % 28 + 1)))" 40)
  grpc logpipeline.LogIngestion/SendRecords \
    -d "{\"filename\":\"chaos_${i}.csv\",\"records\":$batch}" > /dev/null &
done

sleep 2
yellow "CAOS: SIGKILL csvconsumer + crash Postgres al mismo tiempo..."
docker kill csvconsumer-test-app > /dev/null
docker stop csvconsumer-test-db

wait

sleep 3
yellow "Recuperando: Postgres + csvconsumer..."
docker start csvconsumer-test-db
STARTS=$((STARTS+1))
docker start csvconsumer-test-app > /dev/null
wait_app_ready $STARTS
sleep 20

rows_t7=$(count_rows)
new_t7=$((rows_t7 - rows_t6))
check_gte "WAL rescató datos del caos total (≥160 registros nuevos)" 160 "$new_t7"

# ── Test 8: Sistema estable después del caos ─────────────────────────────────
title "8. Post-caos — sistema totalmente estable y funcional"
result=$(grpc logpipeline.LogIngestion/Ping)
check "Ping ok post-caos" '"ok"' "$result"

batch=$(make_batch "POSTCHAOS" "2026-08-01" 10)
result=$(grpc logpipeline.LogIngestion/SendRecords \
  -d "{\"filename\":\"postchaos.csv\",\"records\":$batch}")
check "Inserta normalmente post-caos" '"inserted": 10' "$result"
sleep 8
rows_final=$(count_rows)
check_gte "10 registros post-caos llegaron a PostgreSQL" $((rows_t7 + 10)) "$rows_final"

# ── Resumen ───────────────────────────────────────────────────────────────────
title "RESUMEN DE CAOS"
echo "Filas finales en PostgreSQL : $rows_final"
echo "WAL recoveries totales      : $(wal_recoveries)"
echo "Arranques de csvconsumer    : $STARTS"
echo ""
echo "Desglose por test:"
echo "  T1 bulk(50):          $rows_t1 filas"
echo "  T2 concurrencia×10:   +$new_t2 = $rows_t2 filas"
echo "  T3 crash bajo carga:  +$new_t3 = $rows_t3 filas"
echo "  T4 3×SIGKILL:         +$new_t4 = $rows_t4 filas"
echo "  T5 3×PG crash:        +$new_t5 = $rows_t5 filas"
echo "  T6 100 inválidos:     +0 = $rows_t6 filas (correcto)"
echo "  T7 caos total:        +$new_t7 = $rows_t7 filas"
echo "  T8 post-caos:         +10 = $rows_final filas"
echo ""
echo "Últimas 20 líneas de log:"
app_logs | tail -20
echo ""
green "PASSED: $PASS"
if [ $FAIL -gt 0 ]; then
  red "FAILED: $FAIL"
else
  green "FAILED: 0 — sistema sobrevivió el caos total"
fi

echo ""
echo "Para limpiar: docker compose -f $SCRIPT_DIR/docker-compose.test.yml down -v"
