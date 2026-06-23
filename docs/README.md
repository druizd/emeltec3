# Documentación — Emeltec Cloud

Índice de la documentación del repo. Punto de entrada; el contenido vive en cada archivo.

## Arquitectura y dominio

| Doc                                                              | Tema                                                |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| [ARQUITECTURA-FLUJO-DATOS.md](./ARQUITECTURA-FLUJO-DATOS.md)     | Flujo de datos end-to-end (ingesta → DB → frontend) |
| [contadores-delta-algorithm.md](./contadores-delta-algorithm.md) | Algoritmo de contadores delta                       |
| [mathei-simulation-worker.md](./mathei-simulation-worker.md)     | Worker de simulación Mathei                         |

## DGA (cumplimiento regulatorio)

| Doc                                                | Tema                                                            |
| -------------------------------------------------- | --------------------------------------------------------------- |
| [dga-reporte-proceso.md](./dga-reporte-proceso.md) | Diseño del proceso de reporte DGA (workers, estados, lifecycle) |
| [dga-smoke-tests.md](./dga-smoke-tests.md)         | Checklist de smoke tests del pipeline DGA                       |

## Operación

| Doc                              | Tema                                                      |
| -------------------------------- | --------------------------------------------------------- |
| [deployment.md](./deployment.md) | Runbook de despliegue (VM Azure, docker-compose, secrets) |
| [testing.md](./testing.md)       | Guía de testing y conteo de suites                        |

## Diseño

| Recurso                            | Tema                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| [design-system/](./design-system/) | Bundle del Emeltec Design System (vendored): tokens, tipografía, UI kit |

## Registros (no editar)

| Recurso                                                  | Estado                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [security-audit/](./security-audit/)                     | Registros de auditoría ISO 27001 (2026-06). **Congelados** — auditorías futuras crean archivos nuevos, no editan estos. |
| [optimizaciones-2026-05.md](./optimizaciones-2026-05.md) | Snapshot histórico de performance (mayo 2026). No se mantiene al día.                                                   |

## Por servicio

Cada paquete tiene su propio `README.md` (instalación/uso) y, los servicios principales, `ARCHITECTURE.md` (diseño interno):

- `main-api/` — README + ARCHITECTURE
- `auth-api/` — ARCHITECTURE
- `grpc-pipeline/` — README; `csvprocessor/` y `csvconsumer-rust/` con ARCHITECTURE
- `frontend-angular/`, `landing-emeltec/`, `metrics-page/`, `infra-db/`, `linux-db-api/`, `ftp-pipeline/ftpconsumer-rust/` — README

## Instrucciones para agentes IA

Fuente única en la raíz: [`AGENTS.md`](../AGENTS.md) (estándar cross-tool). `CLAUDE.md` apunta a ese archivo.
