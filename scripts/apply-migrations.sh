#!/usr/bin/env bash
# Aplica las migraciones SQL pendientes de un directorio y registra cada una en
# public.sql_migrations (nombre de archivo + sha256).
#
# No confundir con public.schema_migrations: esa es de las migraciones .js de
# main-api (main-api/migrations/run.js), con otro esquema.
#
# Uso: apply-migrations.sh <directorio> <comando psql...>
#   apply-migrations.sh infra-db/migrations psql -h localhost -U postgres -d db
#
# Un archivo se aplica si es nuevo o si su checksum cambió desde la última vez:
# editar una migración ya aplicada la vuelve a correr, como antes. Los archivos
# sin cambios se saltan, así el deploy no pide locks sobre tablas vivas por
# migraciones que ya están en la base.
set -Eeuo pipefail

if [ "$#" -lt 2 ]; then
  echo "Uso: $0 <directorio> <comando psql...>" >&2
  exit 2
fi

MIGRATIONS_DIR="$1"
shift
PSQL_CMD=("$@")

run_psql() {
  "${PSQL_CMD[@]}" -X -v ON_ERROR_STOP=1 "$@"
}

# Consultas cortas con -c: stdin desde /dev/null para que `docker compose exec -T`
# no se quede leyendo el stdin del deploy.
run_psql_query() {
  run_psql "$@" </dev/null
}

run_psql_query -q -c "CREATE TABLE IF NOT EXISTS public.sql_migrations (
  filename   TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)"

# El registro se lee a una variable y no con `< <(...)`: dentro de una
# sustitución de proceso un error no corta el script, y se tomaría como "nada
# aplicado", re-aplicando todo.
registry="$(run_psql_query -At -c "SELECT filename || '|' || checksum FROM public.sql_migrations")"

declare -A applied=()
while IFS='|' read -r name sum; do
  [ -n "$name" ] && applied["$name"]="$sum"
done <<< "$registry"

applied_count=0
skipped_count=0

for migration in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$migration" ] || continue
  name="$(basename "$migration")"
  sum="$(sha256sum "$migration" | cut -d' ' -f1)"

  if [ "${applied[$name]:-}" = "$sum" ]; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if [ -n "${applied[$name]:-}" ]; then
    echo "Re-applying $name (changed since it was last applied)..."
  else
    echo "Applying $name..."
  fi

  run_psql < "$migration"

  # Se registra solo si la migración terminó bien: con ON_ERROR_STOP y
  # `set -e`, un error corta el script antes de llegar aquí.
  run_psql -q -v name="$name" -v sum="$sum" <<'SQL'
INSERT INTO public.sql_migrations (filename, checksum)
VALUES (:'name', :'sum')
ON CONFLICT (filename) DO UPDATE
  SET checksum = EXCLUDED.checksum, applied_at = now();
SQL

  applied_count=$((applied_count + 1))
done

echo "Migrations: $applied_count applied, $skipped_count already up to date."
