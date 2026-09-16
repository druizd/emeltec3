#!/usr/bin/env bash
# Test local de csvconsumer.
# Requiere: Docker corriendo.
# Uso: bash grpc-pipeline/test/run-test.sh (desde la raíz del repo)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="$(realpath "$SCRIPT_DIR/../proto")"

echo "=== 1. Build + arranque de servicios ==="
docker compose -f "$SCRIPT_DIR/docker-compose.test.yml" up --build -d

echo ""
echo "=== 2. Esperando que csvconsumer esté listo (30s max) ==="
for i in $(seq 1 30); do
  if docker logs csvconsumer-test-app 2>&1 | grep -q "csvconsumer puerto="; then
    echo "✅ csvconsumer listo"
    break
  fi
  echo "  ... esperando ($i/30)"
  sleep 1
done

echo ""
echo "=== 3. Ping ==="
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$PROTO_DIR:/proto" \
  fullstorydev/grpcurl:latest \
  -plaintext \
  -import-path /proto \
  -proto logpipeline.proto \
  host.docker.internal:50052 \
  logpipeline.LogIngestion/Ping

echo ""
echo "=== 4. Enviar lote de 5 registros ==="
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$PROTO_DIR:/proto" \
  fullstorydev/grpcurl:latest \
  -plaintext \
  -import-path /proto \
  -proto logpipeline.proto \
  -d '{
    "filename": "test_2026-07-15.csv",
    "records": [
      {"id_serial": "SN-TEST-001", "fecha": "2026-07-15", "hora": "10:00:00", "data": "{\"nivel\":5.2,\"caudal\":1.1}"},
      {"id_serial": "SN-TEST-001", "fecha": "2026-07-15", "hora": "10:01:00", "data": "{\"nivel\":5.3,\"caudal\":1.2}"},
      {"id_serial": "SN-TEST-001", "fecha": "2026-07-15", "hora": "10:02:00", "data": "{\"nivel\":5.1,\"caudal\":1.0}"},
      {"id_serial": "SN-TEST-002", "fecha": "2026-07-15", "hora": "10:00:00", "data": "{\"nivel\":3.8,\"caudal\":0.9}"},
      {"id_serial": "SN-TEST-002", "fecha": "2026-07-15", "hora": "10:01:00", "data": "{\"nivel\":3.9,\"caudal\":0.8}"}
    ]
  }' \
  host.docker.internal:50052 \
  logpipeline.LogIngestion/SendRecords

echo ""
echo "=== 5. Esperando flush (5s) ==="
sleep 5

echo ""
echo "=== 6. Verificar registros en PostgreSQL ==="
docker exec csvconsumer-test-db psql -U admin_test -d db_test -c \
  "SELECT time, id_serial, data FROM equipo ORDER BY time;"

echo ""
echo "=== 7. Verificar WAL SQLite (done=1 significa insertado correctamente) ==="
docker exec csvconsumer-test-app sh -c \
  'sqlite3 /data/test-wal.db "SELECT id, id_serial, done FROM pending_records ORDER BY id;"' 2>/dev/null \
  || echo "  (sqlite3 no disponible en contenedor — verificar vía logs)"

echo ""
echo "=== 8. Logs de csvconsumer ==="
docker logs csvconsumer-test-app 2>&1 | tail -20

echo ""
echo "=== TEST COMPLETO ==="
echo "Para limpiar: docker compose -f $SCRIPT_DIR/docker-compose.test.yml down -v"
