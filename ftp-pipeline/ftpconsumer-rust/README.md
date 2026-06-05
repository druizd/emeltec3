# ftpconsumer-rust

Consumer gRPC independiente para el `ftpprocessor` Windows.

Servicio protobuf: `LogIngestion`.

RPCs:

- `Ping`
- `SendRecords`

Payload esperado:

```json
{
  "filename": "REGADIO_log_20260506_20260602.csv",
  "records": [
    {
      "id_serial": "REGADIO",
      "fecha": "2026-05-06",
      "hora": "11:26:00",
      "data": "{\"Nivel Freat\":17.3,\"Flujo Insta\":0}"
    }
  ]
}
```

Inserta en:

```sql
equipo(time, id_serial, data)
```

Puerto gRPC por defecto:

```text
50061
```
