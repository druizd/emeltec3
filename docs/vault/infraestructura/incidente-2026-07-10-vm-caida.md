# Incidente: VM Linux caída — 2026-07-10

**Estado:** ✅ Resuelto — 19:10 UTC aprox.

## Síntomas detectados

- csvprocessor (Windows) comenzó a fallar con errores gRPC en puerto `50051`
- main-api en puerto `3000` no respondía (`context deadline exceeded`)
- Ping a `145.190.8.19` → 100% pérdida de paquetes
- SSH a `145.190.8.19` → colgaba sin conectar

## Cronología

| Hora  | Evento |
|-------|--------|
| ~14:36 | Primeros errores gRPC `Unavailable` — "closed network connection" |
| ~14:36 | Alertas a main-api fallan por timeout |
| ~14:36 | Errores cambian a `DeadlineExceeded` (servidor parcialmente vivo o reiniciando) |
| ~14:37 | Algunos archivos logran enviarse en intento 3/3 (23s de latencia) |
| ~14:3x | VM completamente inaccesible (ping 100% pérdida) |
| ~14:46 | Error cambia a `actively refused it` — VM reiniciando o containers bajados |
| **14:55:38** | **gRPC `:50051` vuelve** — VM arriba, csvprocessor empieza a enviar ok |
| 14:55:38+ | main-api `:3000` sigue con `context deadline exceeded` — container no levantó |

## Causa raíz

**Desconocida aún.** El servicio `metrics` (según Dylan) "rompió todo". Probable: container que consume recursos hasta colgar la VM.

## Resolución

1. Dylan reinicia la VM desde Azure Portal
2. Una vez la VM vuelve, verificar que los containers suban solos (o hacer `docker compose up -d`)
3. csvprocessor se recupera solo (tiene retry automático con 3 intentos)

## Cómo detectarlo rápido en el futuro

```bash
# Desde Git Bash — verificar conectividad
ping 145.190.8.19

# Si ping responde, SSH:
ssh -i ~/Downloads/key.pem azureuser@145.190.8.19

# Una vez adentro, ver estado containers:
docker ps
docker compose logs --tail=50 metrics
```

## Pasos de resolución (para futuros incidentes)

1. Ping al servidor — si 100% pérdida, VM caída → Dylan reinicia desde Azure Portal
2. Una vez ping responde, SSH y correr `docker ps`
3. Si containers down → `docker compose up -d`
4. Reiniciar nginx: `sudo systemctl restart nginx`
5. Si página sigue con 502 → `docker restart emeltec-frontend emeltec-api emeltec-db`
6. Verificar en browser con Ctrl+Shift+R

## Acciones post-incidente pendientes

- [x] VM subió (gRPC volvió a las 14:55:38 hora Chile / 17:55 UTC)
- [x] Todos los containers corriendo (`docker ps` — 10/10 healthy)
- [x] Nginx reiniciado (`sudo systemctl restart nginx`)
- [x] Containers `emeltec-frontend`, `emeltec-api`, `emeltec-db` reiniciados manualmente
- [x] Página funcionando sin errores
- [ ] Revisar logs del container `metrics` para entender qué lo colgó
- [ ] Evaluar si agregar restart policy `unless-stopped` en docker-compose
- [ ] Evaluar monitoreo de salud de la VM (Azure Monitor o similar)
- [ ] Gestionar acceso a Azure Portal para Moises

## Notas

- Moises no tiene acceso directo a Azure Portal → bottleneck operacional
- csvprocessor corre en Windows, se conecta al Linux por gRPC `:50051`
- main-api corre en Linux `:3000`
