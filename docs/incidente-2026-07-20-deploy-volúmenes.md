# Incidente 2026-07-20 — Deploy perdió datos por cambio de nombre de proyecto Docker

## Qué pasó

Al hacer deploy del PR #161 (rol Vendedor + WAL csvconsumer) desde el directorio `~/emeltec3`,
Docker Compose generó un nombre de proyecto nuevo (`emeltec3`) basado en el nombre del directorio.
El proyecto anterior se llamaba `emeltec-platform` (directorio original).

Docker Compose nombra los volúmenes como `<proyecto>_<volumen>`, entonces:

- Volúmenes con datos reales: `emeltec-platform_timescale_data`, `emeltec-platform_redis_data`
- Volúmenes vacíos creados por error: `emeltec3_timescale_data`, `emeltec3_redis_data`

Los contenedores levantaron con los volúmenes vacíos → DB sin usuarios → login 500/401.

## Errores observados

| Error | Causa |
|-------|-------|
| `POST /api/auth/start → 500` | Faltaba columna `activo` en tabla `usuario` (migración no aplicada) |
| `POST /api/auth/login → 401` | DB vacía, usuario no existía |
| `column "coord_norte" does not exist` | Migraciones pendientes desde mayo/junio |
| `column "dga_activo" does not exist` | Ídem |
| `relation "cold_room_alarm_rule" does not exist` | Ídem |
| `relation "audit_log" does not exist` | Ídem |

## Solución aplicada

### 1. Restaurar volúmenes correctos

```bash
docker compose down
docker compose -p emeltec-platform up -d
```

### 2. Aplicar migraciones pendientes

```bash
source .env && for f in infra-db/migrations/*.sql; do
  echo "→ $f"
  docker exec -i emeltec-db psql -U $POSTGRES_USER -d $POSTGRES_DB < "$f"
done
```

Todas las migraciones son idempotentes (`IF NOT EXISTS`) — se pueden re-aplicar sin riesgo.

## Solución permanente

Fijar el nombre del proyecto en `.env` para que no dependa del nombre del directorio:

```bash
echo "COMPOSE_PROJECT_NAME=emeltec-platform" >> .env
```

Con esto, `docker compose up` desde cualquier directorio siempre usa los volúmenes correctos.

## Verificación post-deploy

```bash
# Contenedores corriendo
docker compose ps

# Usuarios en DB
source .env && docker exec -i emeltec-db psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT id, email, tipo FROM usuario ORDER BY id;"

# Logs sin errores de columna faltante
docker compose logs --tail=30 main-api
docker compose logs --tail=30 auth-api

# CSVs procesándose
docker compose logs -f csvconsumer
```

## Checklist deploy futuro

- [ ] Verificar `COMPOSE_PROJECT_NAME=emeltec-platform` en `.env` del servidor
- [ ] Correr migraciones pendientes antes o después del `docker compose up`
- [ ] Confirmar login funciona antes de dar el deploy por cerrado
