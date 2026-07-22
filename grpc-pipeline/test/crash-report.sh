#!/usr/bin/env bash
# Reporte de crashes de los containers de test.
# Muestra: eventos (cuándo se cayó/levantó) + últimos logs de cada container.
#
# Uso: bash grpc-pipeline/test/crash-report.sh

CONTAINERS=(csvconsumer-test-app csvconsumer-test-db)

echo "=== ESTADO ACTUAL ==="
for c in "${CONTAINERS[@]}"; do
  status=$(docker inspect "$c" --format '{{.State.Status}} | reinicios={{.RestartCount}} | salida={{.State.ExitCode}} | finalizó={{.State.FinishedAt}}' 2>/dev/null \
    || echo "container no existe")
  echo "  $c: $status"
done

echo ""
echo "=== EVENTOS (die / start / restart) ==="
docker events \
  --filter type=container \
  --filter event=die \
  --filter event=start \
  --filter event=restart \
  --filter event=kill \
  --since 24h \
  --until 0s \
  --format '{{.Time}} | {{.Actor.Attributes.name}} | {{.Action}} | exitCode={{.Actor.Attributes.exitCode}}' \
  2>/dev/null | grep -E "$(IFS='|'; echo "${CONTAINERS[*]}")" \
  || echo "  (sin eventos en las últimas 24h)"

echo ""
echo "=== ÚLTIMOS LOGS DE CADA CONTAINER ==="
for c in "${CONTAINERS[@]}"; do
  echo "--- $c (últimas 30 líneas) ---"
  docker logs --timestamps "$c" 2>&1 | tail -30
  echo ""
done
