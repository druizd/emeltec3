# `equipo` — Hypertable de telemetría raw

Tabla principal de datos. **Una fila = una lectura de un dispositivo en un timestamp.**

---

## Schema

| Columna       | Tipo                        | Descripción                                                                 |
| ------------- | --------------------------- | --------------------------------------------------------------------------- |
| `time`        | `timestamptz NOT NULL`      | Timestamp de la lectura (UTC) — dimensión temporal del hypertable           |
| `id_serial`   | `varchar(50) NOT NULL`      | ID del dispositivo Windows. Enlaza con `sitio.id_serial`                    |
| `data`        | `jsonb NOT NULL`            | Valores del sensor. Claves = registros Modbus (ej. `{"D1": 1234, "D2": 0}`) |
| `received_at` | `timestamptz DEFAULT now()` | Cuando csvconsumer insertó el dato                                          |

---

## Índices

| Índice                   | Tipo  | Columnas                 | Uso                             |
| ------------------------ | ----- | ------------------------ | ------------------------------- |
| `equipo_time_idx`        | btree | `time DESC`              | Queries por rango de fecha      |
| `idx_equipo_serial_time` | btree | `(id_serial, time DESC)` | Queries por dispositivo + fecha |
| `idx_equipo_data_gin`    | GIN   | `data`                   | Búsqueda dentro del JSONB       |

---

## Trigger anti-duplicado

`trg_prevent_equipo_duplicate_exact` — se ejecuta **BEFORE INSERT**.

Si ya existe una fila con el mismo `(id_serial, time, data)` exacto, el INSERT se descarta silenciosamente (no lanza error). Permite reinsertar datos históricos de forma segura.

```sql
-- Verificar si un dato ya existe
SELECT COUNT(*) FROM equipo
WHERE id_serial = 'ABC123'
  AND time = '2026-07-13 10:00:00+00'
  AND data = '{"D1": 1234}'::jsonb;
```

---

## Flujo de escritura

```
csvprocessor (Windows)
  → gRPC → csvconsumer (Linux, Rust)
    → cola in-memory
      → flush batch (cada N ms)
        → INSERT INTO equipo(time, id_serial, data)
          → trigger: descarta duplicados
            → TimescaleDB: distribuye en chunk por rango de time
```

---

## Continuous aggregates derivadas

| Vista         | Granularidad              |
| ------------- | ------------------------- |
| `equipo_1min` | 1 minuto por `id_serial`  |
| `equipo_5min` | 5 minutos por `id_serial` |

Los gráficos del frontend leen de estas vistas, no de `equipo` directo.

---

## Queries útiles

```sql
-- Últimas lecturas de un dispositivo
SELECT time, data
FROM equipo
WHERE id_serial = 'TU_SERIAL'
ORDER BY time DESC
LIMIT 20;

-- Registros por dispositivo en un rango
SELECT id_serial, COUNT(*) as registros
FROM equipo
WHERE time >= '2026-07-10' AND time < '2026-07-14'
GROUP BY id_serial
ORDER BY registros DESC;

-- Ver estructura del JSONB de un sitio
SELECT data FROM equipo
WHERE id_serial = 'TU_SERIAL'
ORDER BY time DESC LIMIT 1;
```

---

## Ver también

- [[overview]] — arquitectura TimescaleDB
- [[reg-map]] — cómo se interpreta `data`
- [[../grpc-pipeline/csvconsumer]] — quién escribe en esta tabla
