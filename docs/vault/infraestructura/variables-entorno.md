---
aliases: [env, variables, entorno, secrets]
tags: [vault/infrastructure]
---

# Variables de entorno — `~/emeltec3/.env`

← [[HOME]] | Ver también: [[servicios]] · [[deployment]] · [[dga-setup]]

---

## Variables críticas

> [!danger] Nunca commitear este archivo
> `.env` está en `.gitignore`. Contiene credenciales reales de producción.

### Base de datos

| Variable            | Función                                  |
| ------------------- | ---------------------------------------- |
| `POSTGRES_USER`     | Usuario PostgreSQL                       |
| `POSTGRES_DB`       | Nombre de la base (`telemetry_platform`) |
| `POSTGRES_PASSWORD` | Contraseña DB                            |

### Autenticación

| Variable           | Función                                              |
| ------------------ | ---------------------------------------------------- |
| `JWT_SECRET`       | Firma JWT — compartido entre `main-api` y `auth-api` |
| `RESEND_API_KEY`   | Envío de OTP 2FA por email                           |
| `INTERNAL_API_KEY` | Service-to-service (`linux-db-api`)                  |

### DGA

| Variable             | Función                                                    |
| -------------------- | ---------------------------------------------------------- |
| `DGA_ENCRYPTION_KEY` | AES-256-GCM para `clave_informante` en `dga_informante`    |
| `DGA_RUT_EMPRESA`    | RUT del Centro de Control Emeltec (informante corporativo) |

### Workers DGA — flags de habilitación

| Variable                       | Default     | Función                                             |
| ------------------------------ | ----------- | --------------------------------------------------- |
| `ENABLE_DGA_PRESEED_WORKER`    | `true`      | Crea slots vacíos cada 6h                           |
| `ENABLE_DGA_WORKER`            | `true`      | Llena slots con datos cada 60s                      |
| `ENABLE_DGA_SUBMISSION_WORKER` | **`false`** | **Envío real a SNIA — NO activar sin autorización** |
| `ENABLE_DGA_RECONCILER`        | `true`      | Auditoría cada 1h                                   |

### ftpprocessor (Windows Server)

| Variable         | Función                                                  |
| ---------------- | -------------------------------------------------------- |
| `DEVICE_ALIASES` | `REGADIO:25120112,CASINO:25120225` — mapeo nombre→serial |

---

## Cambiar una variable

```bash
# 1. Editar en VM
nano ~/emeltec3/.env

# 2. Reiniciar el container afectado
docker compose restart main-api
# o redeploy completo:
bash scripts/deploy-production.sh
```

> [!warning] Cambiar `JWT_SECRET` invalida todas las sesiones activas.
> Cambiar `DGA_ENCRYPTION_KEY` rompe todas las claves DGA cifradas en DB — requiere re-cifrar.
