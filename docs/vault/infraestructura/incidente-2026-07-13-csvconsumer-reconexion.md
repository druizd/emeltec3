# Incidente: csvconsumer pierde conexión a PostgreSQL — 2026-07-13

**Estado:** ✅ Resuelto — fix inmediato aplicado | ⏳ Fix permanente pendiente de deploy

## Síntomas detectados

- Windows enviaba datos correctamente (gRPC ok)
- csvconsumer encolaba los registros pero **nunca los insertaba**
- Logs mostraban el mismo error en loop:
  ```
  flush error: connection closed
  flush error: connection closed
  ...
  ```
- La plataforma no mostraba datos nuevos

## Causa raíz

`tokio_postgres::connect()` devuelve **dos objetos**:
- `Client` — ejecuta queries
- `Connection` — tarea de fondo que mantiene el socket TCP vivo

Ambos deben existir simultáneamente. Si `Connection` muere (reinicio del DB, blip de red), el `Client` queda **permanentemente roto** — todas las queries siguientes devuelven `connection closed`.

El código original de csvconsumer no tenía lógica de reconexión. Resultado: el servicio seguía aceptando datos de Windows y encolándolos, pero cada intento de flush fallaba en silencio.

## Cronología

| Hora | Evento |
|------|--------|
| ~desconocida | DB/red interrumpe Connection task |
| loop | `flush error: connection closed` repetido |
| 2026-07-13 | Detectado al verificar que la plataforma no mostraba datos |
| 2026-07-13 | `docker restart emeltec-csvconsumer` → datos fluyeron de nuevo |

> No hubo pérdida de datos: la cola en memoria mantuvo los registros y los insertó en batch al reiniciar.

## Resolución inmediata

```bash
ssh -i ~/Downloads/key.pem azureuser@145.190.8.19
docker restart emeltec-csvconsumer
```

## Fix permanente (código — pendiente deploy)

Archivo: `grpc-pipeline/csvconsumer-rust/src/main.rs`

Cambios:
- `type SharedClient = Arc<Mutex<Arc<Client>>>` — cliente compartido con capacidad de reemplazo
- En `flush_task`: cuando `insert_batch` devuelve `e.is_closed()`:
  1. Re-encola el batch en orden usando `push_front` (para no perder datos)
  2. Reconecta con backoff exponencial: `2s → 4s → 8s → ... → 60s máx`
  3. Reemplaza el cliente roto con el nuevo: `*shared_client.lock().await = new_client`
  4. Sale del inner loop — el ticker retoma el flush en el siguiente ciclo

Para deployar:
```bash
# push al repo → CI build → en Linux:
docker restart emeltec-csvconsumer
```

## Cómo detectarlo rápido

```bash
# Desde Linux — ver logs de csvconsumer
docker logs emeltec-csvconsumer --tail=50

# Si ves "flush error: connection closed" en loop → reiniciar:
docker restart emeltec-csvconsumer
```

## Acciones post-incidente

- [x] Detectado y diagnosticado
- [x] Fix inmediato: `docker restart emeltec-csvconsumer`
- [x] Confirmado: no hubo pérdida de datos (cola en memoria)
- [x] Código fix implementado en `main.rs`
- [x] Issue GitHub #139 creado
- [ ] Commit + push del fix
- [ ] Deploy en Linux (CI + restart container)

## Notas

- La cola en memoria de csvconsumer actúa como buffer: mientras no se reinicia el proceso, los datos no se pierden aunque el DB esté caído
- Después del restart, los datos encolados se insertan en bulk (spike visible en métricas de DB)
- Ver también: [[incidente-2026-07-10-vm-caida]] — incidente anterior donde la VM completa cayó
