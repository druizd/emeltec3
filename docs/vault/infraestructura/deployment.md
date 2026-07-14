---
aliases: [deploy, despliegue, migracion]
tags: [vault/infrastructure]
---

# Deployment — Runbook de producción

← [[HOME]] | Ver también: [[servicios]] · [[variables-entorno]] · [[quick-ref]]

---

## Deploy estándar

> [!tip] Deploy manual en VM Linux
> ```bash
> ssh -i ~/Downloads/key.pem azureuser@145.190.8.19
> cd ~/emeltec3
> bash scripts/deploy-production.sh
> ```
> El script hace: `git pull` → build → restart containers → health check.

> [!tip] Health check post-deploy
> ```bash
> curl -s http://localhost:3000/api/v2/health/live
> docker compose ps
> ```

---

## Aplicar migración SQL manualmente

> [!example] Template
> ```bash
> docker compose exec -T timescaledb psql -U postgres -d telemetry_platform \
>   < ~/emeltec3/infra-db/migrations/NOMBRE.sql
> ```

> [!warning] Orden de migraciones
> Las migraciones deben aplicarse en orden cronológico. Ver historial completo en [[migraciones]].

---

## Logs post-deploy

> [!info] Verificar workers DGA arrancaron
> ```bash
> docker compose logs main-api --since 5m | grep -iE "worker|iniciado|preseed|dga"
> ```
> Esperado:
> ```
> DGA preseed worker iniciado
> DGA fill worker iniciado
> DGA reconciler iniciado
> ```

> [!danger] Submission worker — mantener OFF
> `ENABLE_DGA_SUBMISSION_WORKER=false` — **no cambiar sin autorización de gerencia**.
> Ver [[variables-entorno]] para todas las flags de workers.

---

## Rollback

> [!warning] Si el deploy falla
> ```bash
> cd ~/emeltec3
> git log --oneline -5          # ver commits recientes
> git checkout <commit-anterior>
> bash scripts/deploy-production.sh
> ```
