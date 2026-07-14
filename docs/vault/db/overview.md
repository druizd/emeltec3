# Base de Datos — Overview

**Motor:** PostgreSQL 15 + **TimescaleDB**
**DB:** `telemetry_platform`
**Host:** container Docker `emeltec-db` en VM Linux `145.190.8.19`

---

## Arquitectura

```
empresa
  └── sub_empresa
        └── sitio  ←→  equipo (hypertable, raw telemetría)
              │              ↓
              │         equipo_1min  (continuous aggregate, 1 min)
              │         equipo_5min  (continuous aggregate, 5 min)
              │
              ├── reg_map         (mapeo registros Modbus → dashboard)
              ├── pozo_config     (config pozo + pipeline DGA)
              ├── dato_dga        (hypertable, slots DGA)
              ├── alertas / alertas_eventos
              ├── incidencias / incidencia_tecnicos
              ├── documentos
              ├── site_operacion_config
              └── site_contador_mensual
```

---

## Hypertables (TimescaleDB)

| Tabla | Descripción | PK / dimensión temporal |
|-------|-------------|------------------------|
| `equipo` | Raw telemetría de dispositivos | `time` |
| `dato_dga` | Slots de reporte DGA | `(site_id, ts)` |

TimescaleDB parte cada hypertable en **chunks** por rango de tiempo (carpetas `_timescaledb_internal._hyper_N_M_chunk`). `equipo` tiene ~1000+ chunks activos. Nunca interactuar con chunks directamente.

## Continuous aggregates

Vistas pre-calculadas sobre `equipo`. Se refrescan automáticamente para datos en tiempo real. Para datos históricos insertados tarde, refrescar manual:

```sql
CALL refresh_continuous_aggregate('equipo_1min', '2026-01-01', '2026-01-08');
CALL refresh_continuous_aggregate('equipo_5min', '2026-01-01', '2026-01-08');
```

| Vista | Granularidad | Uso |
|-------|-------------|-----|
| `equipo_1min` | 1 minuto | Gráficos día/semana, DGA worker |
| `equipo_5min` | 5 minutos | Gráficos mes/año |

---

## Comandos de diagnóstico

```bash
# Conectar a la DB
docker exec -it emeltec-db psql -U postgres -d telemetry_platform

# Ver todas las tablas
\dt

# Ver hypertables
SELECT hypertable_name FROM timescaledb_information.hypertables;

# Ver continuous aggregates
SELECT view_name, materialization_hypertable_name
FROM timescaledb_information.continuous_aggregates;

# Chunks recientes de equipo
SELECT chunk_name, range_start, range_end
FROM timescaledb_information.chunks
WHERE hypertable_name = 'equipo'
ORDER BY range_start DESC LIMIT 10;

# Registros por día (rango histórico)
SELECT DATE(time), COUNT(*)
FROM equipo
WHERE time >= '2026-07-10' AND time < '2026-07-14'
GROUP BY 1 ORDER BY 1;
```

---

## Ver también

- [[equipo]] — hypertable raw telemetría
- [[dato-dga]] — hypertable slots DGA
- [[empresa-sitio]] — jerarquía empresa → sitio
- [[reg-map]] — mapeo de registros Modbus
- [[incidente-2026-07-13-csvconsumer-reconexion]]
