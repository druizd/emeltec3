# Pasar el repositorio a privado

Checklist para que el cambio de visibilidad no altere el flujo de trabajo.
Lo que ya quedó resuelto en el repo está marcado; lo demás son acciones
manuales en la configuración de GitHub o en la VM.

## Por qué conviene

El motivo principal no es el secreto del código: es que **hay un runner
self-hosted con acceso a la VM de producción**. GitHub desaconseja
explícitamente usar runners self-hosted en repositorios públicos, porque un
pull request de cualquier persona puede llegar a ejecutar código en esa
máquina. La VM tiene el `.env` de producción y acceso a la base de datos.

## Lo que cambia

| Aspecto               | Público                          | Privado                 |
| --------------------- | -------------------------------- | ----------------------- |
| Runners GitHub-hosted | Gratis e ilimitados              | Consumen cuota del plan |
| Runner self-hosted    | Riesgo de ejecución por terceros | Solo colaboradores      |
| Logs de Actions       | Visibles sin sesión              | Requieren token         |
| Code scanning         | Gratis                           | Según plan              |

Los workflows que consumen cuota son `build-publish` (1 job), `ci` (3 jobs) y
`deploy-production` (2 jobs). `deploy-selfhosted` corre en la VM y **nunca**
consume cuota.

## Antes de cambiar la visibilidad

- [ ] **Revisar la cuota actual**: Settings → Billing → Actions. Con el ritmo
      habitual el consumo estimado ronda 400–800 min/mes; el plan Free trae
      2.000.
- [ ] **Visibilidad de los paquetes en GHCR**: las imágenes de
      `ghcr.io/druizd/emeltec3/*` tienen visibilidad propia, independiente del
      repo, y no cambian solas. Revisarlas en la pestaña Packages.
- [ ] **Permisos del GITHUB_TOKEN**: Settings → Actions → General → Workflow
      permissions. `build-publish` necesita `packages: write` y
      `deploy-selfhosted` `packages: read`; ambos los declaran en su YAML, pero
      la organización puede imponer un techo más bajo.
- [ ] **Environment `production`**: Settings → Environments. El comentario de
      `deploy-selfhosted.yml` afirma que hay required reviewers y que cada
      deploy pausa hasta aprobación, pero los runs recientes se ejecutaron sin
      esperar. Conviene confirmar si la protección está realmente activa.

## Después de cambiar la visibilidad

- [ ] **Autenticar la VM contra GHCR** para los deploys manuales por SSH. El
      workflow self-hosted hace `docker/login-action` con el `GITHUB_TOKEN`,
      pero un `docker compose pull` a mano necesita credenciales propias:

      ```bash
      echo "$GHCR_TOKEN" | docker login ghcr.io -u druizd --password-stdin
      ```

      El token necesita scope `read:packages`. `scripts/deploy-production.sh`
      ya lo advierte en un comentario.

- [ ] **Verificar un deploy completo** antes de dar el cambio por cerrado:
      push a `main` → build-publish → deploy.

## Ya resuelto en el repo

- `build-publish` ignora los pushes que solo tocan documentación
  (`docs/**`, `**/*.md` y archivos de configuración de formato). Antes un
  commit de documentación gastaba un build completo de los 8 servicios para
  publicar imágenes idénticas.
- `ci.yml` declara `permissions: contents: read` de forma explícita, para no
  depender del valor por defecto del repositorio.

## Ideas para bajar más el consumo

No aplicadas porque tocan el build de producción y conviene probarlas con
calma:

- Cache de capas de Docker en `build-publish` (hoy el build completo tarda
  ~4m 43s y reconstruye todo en cada push a `main`).
- Filtrar por servicio: buildear solo las imágenes cuyos archivos cambiaron,
  en vez de los 8 siempre.
