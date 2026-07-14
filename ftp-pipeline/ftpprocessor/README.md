# ftpprocessor

Servicio Windows independiente para ingestar archivos FTP separados por `;`.

Formato esperado:

```text
DD-MM-YYYY;HH:MM:SS;nombre_dato;valor;unidad;calidad
06-05-2026;11:26:00;Nivel Freat;17,3;m;G
```

Reglas:

- `id_serial` se obtiene desde el nombre del archivo antes del primer `_`.
- `unidad` y `calidad` no se envian a la base de datos.
- `FREESPACE` se ignora.
- Valores sentinel `-999`, `-999,0`, `-999,000` se ignoran.
- Los valores usan coma decimal chilena y se convierten a numero.

El processor envia lotes gRPC al `ftpconsumer-rust`:

```text
LogIngestion.SendRecords
```

Payload:

```json
{
  "filename": "REGADIO_log_20260506_20260602.csv",
  "records": [
    {
      "id_serial": "REGADIO",
      "fecha": "2026-05-06",
      "hora": "11:26:00",
      "data": "{\"Nivel Freat\":17.3}"
    }
  ]
}
```
