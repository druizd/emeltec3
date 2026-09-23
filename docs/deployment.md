# Deploy production

Despliegue automático a la VM cada push a `main`, encadenado en dos workflows
de GitHub Actions: `build-publish.yml` construye las imágenes en un runner
GitHub-hosted y las publica en GHCR; `deploy-selfhosted.yml` se dispara cuando
ese build termina OK y hace el deploy real en la VM (self-hosted runner). Un
tercer workflow, `deploy-production.yml`, solo valida el build en cada push —
su job de deploy (por SSH) es manual.

## Repo y entorno reales

| Campo           | Valor                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| Repo            | `github.com/druizd/emeltec3`                                                                                |
| Branch deploy   | `main`                                                                                                      |
| VM              | `145.190.8.19` (única VM de producción)                                                                     |
| Usuario VM      | `azureuser`                                                                                                 |
| Path repo en VM | `~/emeltec3` (= `/home/azureuser/emeltec3`)                                                                 |
| Container DB    | `emeltec-db` (servicio `timescaledb`, PG16)                                                                 |
| Volumen datos   | `timescale_data` (persiste entre rebuilds)                                                                  |
| Container API   | `emeltec-api` (main-api)                                                                                    |
| DB user/name    | `postgres` / `telemetry_platform`                                                                           |
| Puerto API      | 3000                                                                                                        |
| App productiva  | `nuevacloud.emeltec.cl` — `cloud.emeltec.cl` es la plataforma legacy (ver `infra-nginx/emeltec-sites.conf`) |

> **Nota DB local vs prod**: el compose en `infra-db/docker-compose.yml`
> usa defaults `admin_infra` / `db_infra` para desarrollo local. La VM
> usa los valores reales de `~/emeltec3/.env`. Usar siempre `postgres`
> / `telemetry_platform` para queries en prod.

## Flujo de deploy real

1. Trabajás localmente y probás el cambio.
2. `git commit` + `git push origin main`.
3. **`build-publish.yml`** (`.github/workflows/build-publish.yml`, runner GitHub-hosted):
   - Se salta solo si el push toca _exclusivamente_ `docs/**`, `**/*.md` u otros archivos en `paths-ignore` — un commit que mezcle docs y código sí buildea.
   - Buildea `main-api auth-api linux-db-api frontend-angular landing-emeltec csvconsumer ftpconsumer` con `docker compose build` y los publica en `ghcr.io/druizd/emeltec3/<servicio>` (tags `:latest` y `:<sha>`).
4. **`deploy-selfhosted.yml`** (`.github/workflows/deploy-selfhosted.yml`, runner self-hosted en la VM) — **es el workflow que realmente despliega en cada push a `main`**:
   - Se dispara por `workflow_run` cuando `build-publish.yml` termina con éxito sobre `main` (o manualmente por `workflow_dispatch`).
   - Declara `environment: production` y corre `bash scripts/deploy-production.sh`, que hace `git pull`, aplica migraciones de `infra-db/migrations/*.sql`, `docker compose pull` (**no** buildea en la VM) y `docker compose up -d --no-build --remove-orphans`.
   - El comentario `EMT-H12` en el YAML dice que el `environment: production` tiene "required reviewers" y pausa cada deploy hasta aprobación manual — verificado por API el 2026-09-01 que **ese entorno no tiene reviewers configurados**: el deploy corre solo, sin aprobación. Si se necesita el gate manual, hay que configurarlo en `Settings → Environments → production` (el YAML por sí solo no lo garantiza).
5. **`deploy-production.yml`** (`.github/workflows/deploy-production.yml`) — en cada push a `main` corre **solo** el job `validate` (`docker compose config` + build de imágenes, sin publicar nada). Su job `deploy` (SSH directo a la VM con `AZURE_VM_SSH_KEY`) tiene `if: github.event_name == 'workflow_dispatch'`: solo corre si se lanza manualmente desde `Actions → Run workflow`. El nombre del workflow es engañoso — en push no despliega nada.
6. Fin a fin, un push a `main` termina desplegado en la VM en **~3–10 minutos** (build ~5 min + deploy self-hosted), sin aprobación manual, salvo que se configure el gate del punto 4.
7. Los volúmenes Docker no se borran — los datos sobreviven a cada deploy.

## Preparar la VM (one-time)

```bash
# Clonar repo en el path estándar
cd ~
git clone https://github.com/druizd/emeltec3.git
cd emeltec3

# Crear .env en la VM — usar el .env de la raíz (único archivo para todo el
# stack: Postgres, main-api, auth-api, frontend, etc.), no el de main-api/.
cp .env.example .env
nano .env
```

Variables críticas en `~/emeltec3/.env`:

| Var                                                   | Para qué                                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER` / `POSTGRES_DB` / `POSTGRES_PASSWORD` | DB credentials (no tocar tras primer deploy)                                                                                                                       |
| `JWT_SECRET`                                          | Firma JWT. Compartido entre `main-api` y `auth-api`                                                                                                                |
| `INTERNAL_API_KEY`                                    | Llamadas service-to-service                                                                                                                                        |
| `RESEND_API_KEY` / `RESEND_FROM` / `FRONTEND_URL`     | Códigos de acceso por email                                                                                                                                        |
| `DGA_ENCRYPTION_KEY`                                  | Cifrado AES-256 de claves SNIA en `dga_informante`                                                                                                                 |
| `DGA_API_URL`                                         | Endpoint SNIA (default `https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas`)                                                                                 |
| `ENABLE_DGA_SUBMISSION_WORKER`                        | **Default `false`**. Activar solo cuando gerencia autorice cutover real                                                                                            |
| `MONITOR_PRIMARY_EMAIL`                               | Buzón de respaldo del monitoreo: solo se usa si `health_digest_destinatario` está vacía (los destinatarios se administran en /administration → Alertas por correo) |

> `DGA_RUT_EMPRESA` ya no se configura por `.env` — quedó hardcodeado en
> `main-api/src/config/appConfig.ts` (es información pública, no un secreto).

Prueba deploy manual:

```bash
cd ~/emeltec3
bash scripts/deploy-production.sh
```

## Secretos en GitHub Actions

`Settings → Secrets and variables → Actions`:

| Secret             | Valor                               |
| ------------------ | ----------------------------------- |
| `AZURE_VM_HOST`    | `145.190.8.19`                      |
| `AZURE_VM_USER`    | `azureuser`                         |
| `AZURE_VM_SSH_KEY` | Llave privada SSH (formato ed25519) |
| `AZURE_VM_APP_DIR` | `/home/azureuser/emeltec3`          |

Crear llave dedicada:

```bash
ssh-keygen -t ed25519 -C "github-actions-emeltec" -f ~/.ssh/emeltec_github_actions
```

En la VM, agregá la pública a `~/.ssh/authorized_keys`. En GitHub, guardá
la privada completa en `AZURE_VM_SSH_KEY`.

## Usar el deploy

Cada push a `main` dispara la cadena `build-publish.yml` → `deploy-selfhosted.yml`
descrita arriba. El deploy manual por SSH (`deploy-production.yml`, job `deploy`)
y el `workflow_dispatch` de `deploy-selfhosted.yml` se lanzan desde
`Actions → Run workflow`.

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

Mínimo recomendado (en la VM, contenedores operados con `docker exec`/`docker logs`
directo — `docker compose` no está disponible para uso interactivo en esta VM):

```bash
# Workers DGA iniciados
docker logs emeltec-api --since 5m | grep -iE "dga" | tail -10

# Health endpoint responde
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v2/health/live
# → 200
```

## Logs en la VM

```bash
# Estado de todos los containers
docker ps

# Logs en vivo
docker logs -f emeltec-api
docker logs -f emeltec-frontend
docker logs -f emeltec-auth
docker logs -f emeltec-db

# Últimos N min de un servicio
docker logs emeltec-api --since 10m | tail -100

# Filtrar por módulo (ej. DGA)
docker logs emeltec-api --since 1h | grep -iE "dga|preseed|reconcil|submission"
```

## Acceso a la base

```bash
docker exec -it emeltec-db psql -U postgres -d telemetry_platform
```

Una query inline:

```bash
docker exec -T emeltec-db \
  psql -U postgres -d telemetry_platform -c "SELECT COUNT(*) FROM sitio;"
```

## Migraciones DDL

Las migraciones SQL están en `infra-db/migrations/` y siguen convención
`YYYY-MM-DD-nombre.sql`. `scripts/deploy-production.sh` las aplica automáticamente
en cada deploy (antes de levantar los servicios). Para aplicar manual una
migración nueva:

```bash
docker exec -T emeltec-db \
  psql -U postgres -d telemetry_platform \
  < ~/emeltec3/infra-db/migrations/2026-05-17-dga-pozo-config-redesign.sql
```

Todas son idempotentes (`IF NOT EXISTS`, `DO $$ ... $$` con checks),
seguras de re-correr.

`main-api` tiene además su propio set de migraciones JS numeradas
(`main-api/migrations/00N_*.js`), que se aplican solas al arrancar el
contenedor (`node migrations/run.js && node dist/server.js`, ver
[`main-api/README.md`](../main-api/README.md)) — no requieren paso manual en el deploy.

## Rollback

Las migraciones DGA **no traen down scripts** — los workflows aditivos
nuevos no destruyen data crítica, pero un rollback de schema requiere
restore desde backup. Para rollback de código:

```bash
cd ~/emeltec3
git revert <commit_sha>
git push origin main
# La cadena build-publish → deploy-selfhosted despliega la versión revertida
```

> Si el rollback toca schema (drop de tabla/columna), priorizar restore
> desde backup PG antes que `revert`. Avisar a gerencia.

## Cuando algo falle

1. **Workflow rojo**: revisar log en GitHub Actions UI o `gh run view --log-failed`.
2. **Workflow verde pero algo no anda**: ver logs del servicio en la VM
   (`docker logs -f <container>`).
3. **DB no responde**: `docker ps` → estado de `emeltec-db`.
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
