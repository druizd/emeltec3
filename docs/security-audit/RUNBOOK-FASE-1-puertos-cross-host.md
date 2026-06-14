# Runbook Fase 1 — Puertos cross-host (firewall + auth + TLS)

> Relacionado: **EMT-H01, EMT-H02, EMT-H03**. Aplica a los 3 servicios que se
> consumen desde **otra máquina** (procesadores en Windows), por lo que NO se
> ocultan sus puertos sino que se protegen.

| Servicio | Puerto | Lo consume |
|----------|--------|-----------|
| `linux-db-api` | 3010 | main-api (vía `LINUX_DB_API_URL`) y/o procesos cross-host |
| `csvconsumer` (gRPC) | 50051 | procesador CSV (Windows) |
| `ftpconsumer` (gRPC) | 50061 | procesador FTP (Windows) |

Defensa en 3 capas: **(1) firewall**, **(2) autenticación**, **(3) TLS**.

---

## Capa 1 — Firewall / NSG allowlist (mitigación inmediata)

Permitir esos puertos SOLO desde la(s) IP(s) de los procesadores, denegar el resto.

> Docker en Linux inserta reglas iptables que **saltan UFW**. Para que el filtro
> aplique de verdad, usar la cadena `DOCKER-USER` (o el NSG del proveedor cloud,
> que sí filtra antes que Docker).

### Opción A — Azure NSG (recomendado en la VM Azure)

Regla entrante por cada puerto:
- Origen: IP pública del host de procesadores (Service Tag o IP específica).
- Destino: IP de la VM, puertos 3010 / 50051 / 50061.
- Acción: Allow. Prioridad alta.
- Una regla final Deny para esos puertos desde `Internet`.

### Opción B — iptables DOCKER-USER (en la VM)

```bash
PROC_IP=<ip-del-procesador>
for PORT in 3010 50051 50061; do
  iptables -I DOCKER-USER -p tcp --dport $PORT ! -s $PROC_IP -j DROP
done
# Persistir: netfilter-persistent save   (o iptables-save > /etc/iptables/rules.v4)
```

Verificar desde una IP no autorizada que los puertos den timeout/redado.

---

## Capa 2 — Autenticación

### linux-db-api (3010) — YA aplicado en código

- Ahora es **fail-closed**: sin `INTERNAL_API_KEY` el servicio **no arranca**
  (salvo `ALLOW_INSECURE_NO_AUTH=true` para desarrollo).
- La comparación de la clave es **constant-time**.
- Acción operativa: definir `INTERNAL_API_KEY` (fuerte, `openssl rand -hex 32`)
  en el `.env` de la VM y en el cliente que la llama.

### csvconsumer / ftpconsumer (gRPC) — pendiente de implementar

Hoy el gRPC no valida identidad (`createInsecure`, sin interceptor). Opciones:

1. **Interceptor con token** (más simple): el servidor tonic valida un header de
   metadata `authorization: Bearer <token>` en cada llamada; el cliente Go lo
   envía. Requiere cambio coordinado servidor (Rust) + cliente (Go
   `grpc-pipeline/csvprocessor/internal/grpcclient/client.go`).
2. **mTLS** (más fuerte): certificados de cliente y servidor; el servidor solo
   acepta clientes con certificado válido. Cubre auth + cifrado en un paso.

> Importante: este cambio es **cross-service** (Rust + Go). Desplegar servidor y
> cliente en lockstep o la ingesta se cae. Hacerlo en una ventana coordinada.

### gRPC interno de main-api (`src/grpc/server.js`) — pendiente

main-api levanta su PROPIO servidor gRPC (`MainApi`) en `0.0.0.0:50051` con
`createInsecure()` y handlers (`getLatest`, `getOnlineValues`, `getPreset`,
`getAvailableKeys`) que leen por `serial_id` **sin identidad de llamante** — el
mismo patrón del IDOR HTTP (EMT-C01), pero por gRPC.

- **Mitigante actual:** ese puerto 50051 **no se publica al host** desde el
  contenedor main-api (solo expone 3000), así que su alcance es la red interna de
  Docker, no internet.
- **Pendiente:** cuando se construya la capa de auth gRPC (interceptor/mTLS),
  aplicar el MISMO control de propiedad por serial que ya tiene la capa HTTP
  (`src/services/dataAccess.js` → `resolveAccessibleSerial`). Hasta entonces, no
  publicar 50051 del contenedor main-api y mantenerlo en red interna.
- Cambiar el bind por defecto `0.0.0.0:50051` a una interfaz interna/config.

---

## Capa 3 — TLS (cifrado en tránsito)

- **gRPC**: habilitar `tls_config` en el `Server::builder()` de tonic; el cliente
  Go pasa de `insecure.NewCredentials()` a credenciales TLS. (mTLS cubre esto.)
- **linux-db-api (HTTP)**: ponerlo detrás de un proxy TLS, o habilitar TLS en axum.
- **Conexión a PostgreSQL**: hoy `sslmode=disable` / `NoTls` (EMT-M06). Pasar a
  `sslmode=require` (o `verify-full`) para cualquier tramo que no sea loopback.

---

## Orden recomendado

1. **Hoy:** firewall/NSG allowlist (capa 1) — corta la exposición a internet ya.
2. **Esta semana:** definir `INTERNAL_API_KEY` en linux-db-api (fail-closed ya está).
3. **Ventana coordinada:** auth gRPC (interceptor/mTLS) + TLS en ambos extremos.
4. **Seguimiento:** TLS a PostgreSQL.
