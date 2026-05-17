# Deploy production

Despliegue automático a la VM Azure cada push a `main`. GitHub Actions
ejecuta dos workflows en paralelo (`Deploy production` + `Deploy self-hosted`)
que pullean el código en la VM y reconstruyen los contenedores Docker
Compose.

## Repo y entorno reales

| Campo | Valor |
|---|---|
| Repo | `github.com/druizd/emeltec3` |
| Branch deploy | `main` |
| VM | Azure, `104.46.7.78` |
| Usuario VM | `azureuser` |
| Path repo en VM | `~/emeltec3` (= `/home/azureuser/emeltec3`) |
| Container DB | `timescaledb-infra` (TimescaleDB + PG16) |
| Volumen datos | `timescaledb_data` (persiste entre rebuilds) |
| Container API | `emeltec-api` (main-api) |
| DB user/name | `postgres` / `telemetry_platform` |
| Puerto API | 3000 |

> **Nota DB local vs prod**: el compose en `infra-db/docker-compose.yml`
> usa defaults `admin_infra` / `db_infra` para desarrollo local. La VM
> usa los valores reales de `~/emeltec3/.env`. Usar siempre `postgres`
> + `telemetry_platform` para queries en prod.

## Flujo de deploy

1. Trabajás localmente y probás el cambio.
2. `git commit` + `git push origin main`.
3. GitHub Actions:
   - Valida `docker-compose.yml`.
   - SSH a la VM con la llave de `AZURE_VM_SSH_KEY`.
   - Corre `bash scripts/deploy-production.sh` en `~/emeltec3`.
4. El script hace `git pull`, levanta DB con healthcheck, aplica
   migraciones pendientes en `infra-db/migrations/` y rebuildea servicios.
5. Los volúmenes Docker no se borran — los datos sobreviven.

## Preparar la VM (one-time)

```bash
# Clonar repo en el path estándar
cd ~
git clone https://github.com/druizd/emeltec3.git
cd emeltec3

# Crear .env en la VM
cp main-api/.env.example .env
nano .env
```

Variables críticas en `~/emeltec3/.env`:

| Var | Para qué |
|---|---|
| `POSTGRES_USER` / `POSTGRES_DB` / `POSTGRES_PASSWORD` | DB credentials (no tocar tras primer deploy) |
| `JWT_SECRET` | Firma JWT. Compartido entre `main-api` y `auth-api` |
| `INTERNAL_API_KEY` | Llamadas service-to-service |
| `RESEND_API_KEY` / `RESEND_FROM` / `FRONTEND_URL` | Códigos de acceso por email |
| `DGA_ENCRYPTION_KEY` | Cifrado AES-256 de claves SNIA en `dga_informante` |
| `DGA_RUT_EMPRESA` | RUT del Centro de Control Emeltec ante DGA |
| `DGA_API_URL` | Endpoint SNIA (default `https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas`) |
| `ENABLE_DGA_SUBMISSION_WORKER` | **Default `false`**. Activar solo cuando gerencia autorice cutover real |
| `MONITOR_PRIMARY_EMAIL` | Destino de 2FA email-OTP + alertas reconciler |

Prueba deploy manual:

```bash
cd ~/emeltec3
bash scripts/deploy-production.sh
```

## Secretos en GitHub Actions

`Settings → Secrets and variables → Actions`:

| Secret | Valor |
|---|---|
| `AZURE_VM_HOST` | `104.46.7.78` |
| `AZURE_VM_USER` | `azureuser` |
| `AZURE_VM_SSH_KEY` | Llave privada SSH (formato ed25519) |
| `AZURE_VM_APP_DIR` | `/home/azureuser/emeltec3` |

Crear llave dedicada:

```bash
ssh-keygen -t ed25519 -C "github-actions-emeltec" -f ~/.ssh/emeltec_github_actions
```

En la VM, agregá la pública a `~/.ssh/authorized_keys`. En GitHub, guardá
la privada completa en `AZURE_VM_SSH_KEY`.

## Usar el deploy

Cada push a `main` ejecuta `.github/workflows/deploy-production.yml`.
También se puede correr manualmente desde `Actions → Run workflow`.

Verificar estado de runs recientes:

```bash
gh run list --repo druizd/emeltec3 --limit 5
gh run view <ID> --repo druizd/emeltec3            # detalle
gh run view --repo druizd/emeltec3 --log-failed    # logs fallidos
```

## Validar post-deploy

Tras cada push a main, correr los smoke tests:

```bash
cat docs/dga-smoke-tests.md     # documento con checks completos
```

Mínimo recomendado:

```bash
# Workers DGA iniciados
docker compose -f ~/emeltec3/docker-compose.yml logs main-api --since 5m \
  | grep -iE "dga" | tail -10

# Health endpoint responde
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v2/health/live
# → 200
```

## Logs en la VM

```bash
cd ~/emeltec3

# Estado de todos los containers
docker compose ps

# Logs en vivo
docker compose logs -f main-api
docker compose logs -f frontend-angular
docker compose logs -f auth-api
docker compose logs -f timescaledb

# Últimos N min de un servicio
docker compose logs main-api --since 10m | tail -100

# Filtrar por módulo (ej. DGA)
docker compose logs main-api --since 1h | grep -iE "dga|preseed|reconcil|submission"
```

## Acceso a la base

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform
```

Una query inline:

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform -c "SELECT COUNT(*) FROM sitio;"
```

## Migraciones DDL

Las migraciones SQL están en `infra-db/migrations/` y siguen convención
`YYYY-MM-DD-nombre.sql`. `scripts/deploy-production.sh` las aplica al
levantar DB. Para aplicar manual una migración nueva:

```bash
docker compose -f ~/emeltec3/docker-compose.yml exec -T timescaledb \
  psql -U postgres -d telemetry_platform \
  < ~/emeltec3/infra-db/migrations/2026-05-17-dga-pozo-config-redesign.sql
```

Todas son idempotentes (`IF NOT EXISTS`, `DO $$ ... $$` con checks),
seguras de re-correr.

## Rollback

Las migraciones DGA **no traen down scripts** — los workflows aditivos
nuevos no destruyen data crítica, pero un rollback de schema requiere
restore desde backup. Para rollback de código:

```bash
cd ~/emeltec3
git revert <commit_sha>
git push origin main
# El próximo workflow despliega la versión revertida
```

> Si el rollback toca schema (drop de tabla/columna), priorizar restore
> desde backup PG antes que `revert`. Avisar a gerencia.

## Cuando algo falle

1. **Workflow rojo**: revisar log en GitHub Actions UI o `gh run view --log-failed`.
2. **Workflow verde pero algo no anda**: ver logs del servicio en la VM
   (`docker compose logs -f <svc>`).
3. **DB no responde**: `docker compose ps timescaledb` → estado.
   Healthcheck en `pg_isready -U postgres -d telemetry_platform`.
4. **Pipeline DGA**: ver `docs/dga-smoke-tests.md` para checks completos
   por área (schema / workers / endpoints / hallazgos reconciler).
5. **Datos perdidos / regresión**: NO hacer `docker volume rm` —
   restaurar desde backup PG.

## Pre-flight checklist (antes de un cambio sensible)

- [ ] Build local OK (`npm run build` en `main-api/` + `frontend-angular/`).
- [ ] Migración aditiva o tiene rollback claro.
- [ ] `ENABLE_DGA_SUBMISSION_WORKER` en `false` (a menos que cutover real).
- [ ] Commit message describe alcance + razones.
- [ ] Tras push: correr §2 + §3 de `dga-smoke-tests.md`.
