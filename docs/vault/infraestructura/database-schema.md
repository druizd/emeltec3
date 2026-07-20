# Base de Datos — Emeltec Cloud

**Motor:** PostgreSQL 15 + extensión **TimescaleDB**
**Nombre DB:** `telemetry_platform`
**Host:** Linux VM `145.190.8.19` → container Docker `emeltec-db`

---

## Arquitectura general

```
empresa
  └── sub_empresa
        └── sitio  ←→  equipo (raw telemetry, hypertable)
              ├── reg_map        (mapeo de registros Modbus)
              ├── pozo_config    (config pozo + pipeline DGA)
              ├── dato_dga       (slots DGA, hypertable)
              ├── alertas
              ├── incidencias
              └── documentos
```

---

## Jerarquía de negocio

### `empresa`

Empresa cliente (ej. CCU, ENAP, Codelco).

| Columna        | Tipo               | Descripción                                                                     |
| -------------- | ------------------ | ------------------------------------------------------------------------------- |
| `id`           | varchar(10) PK     | Código corto (ej. "CCU")                                                        |
| `nombre`       | varchar(150)       | Nombre completo                                                                 |
| `rut`          | varchar(20) UNIQUE | RUT empresa                                                                     |
| `tipo_empresa` | varchar(50)        | `'Agua'` / `'Riles'` / `'Proceso'` / `'Eléctrico'` — controla módulo en sidebar |
| `sitios`       | integer            | Contador de sitios activos                                                      |

### `sub_empresa`

División o planta dentro de una empresa (ej. "Planta Norte").

FK: `empresa_id → empresa.id`

### `sitio`

Instalación monitoreada — pozo, medidor, sala fría, etc.

| Columna            | Tipo             | Descripción                                                          |
| ------------------ | ---------------- | -------------------------------------------------------------------- |
| `id`               | varchar(10) PK   | Código corto                                                         |
| `descripcion`      | varchar(255)     | Nombre legible                                                       |
| `id_serial`        | varchar(50)      | **Clave de enlace con `equipo`** — identifica el dispositivo Windows |
| `empresa_id`       | FK → empresa     |                                                                      |
| `sub_empresa_id`   | FK → sub_empresa |                                                                      |
| `tipo_sitio`       | varchar(30)      | `'pozo'` (default), `'medidor'`, etc.                                |
| `activo`           | boolean          | Si aparece en sidebar/dashboard                                      |
| `coord_norte/este` | numeric(12,2)    | Coordenadas UTM WGS84                                                |
| `huso`             | smallint         | Zona UTM (Chile: 18/19/20)                                           |
| `es_maleta_piloto` | boolean          | Override visual: agrupa bajo "Maletas Piloto" sin alterar lógica     |

---

## Telemetría (TimescaleDB)

### `equipo` — hypertable principal

Tabla raw de telemetría. **Cada fila = una lectura de un dispositivo en un timestamp.**

TimescaleDB la parte automáticamente en chunks por tiempo (`_hyper_1_N_chunk`). Hay ~1000+ chunks activos. No interactuar con chunks directamente — siempre usar `equipo`.

| Columna       | Tipo                 | Descripción                                                                           |
| ------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `time`        | timestamptz NOT NULL | Timestamp de la lectura (UTC)                                                         |
| `id_serial`   | varchar(50) NOT NULL | Identifica el dispositivo (= `sitio.id_serial`)                                       |
| `data`        | jsonb NOT NULL       | Valores del sensor en JSON. Claves = registros Modbus (ej. `{"D1": 1234, "D2": 567}`) |
| `received_at` | timestamptz          | Cuando csvconsumer recibió el dato                                                    |

**Índices:**

- `equipo_time_idx` — btree en `time DESC` (queries por rango de fecha)
- `idx_equipo_serial_time` — btree en `(id_serial, time DESC)` (queries por dispositivo)
- `idx_equipo_data_gin` — GIN en `data` (búsqueda dentro del JSONB)

**Trigger:** `trg_prevent_equipo_duplicate_exact`
Previene duplicados exactos `(id_serial, time, data)`. Si llega el mismo dato dos veces, el segundo INSERT se descarta sin error. Permite reinsertar datos históricos de forma segura.

### Continuous aggregates

Vistas pre-calculadas sobre `equipo`. Se actualizan automáticamente para datos nuevos. Para datos históricos insertados tarde → `CALL refresh_continuous_aggregate(...)`.

| Vista         | Granularidad | Uso                                |
| ------------- | ------------ | ---------------------------------- |
| `equipo_1min` | 1 minuto     | Gráficos de día/semana, DGA worker |
| `equipo_5min` | 5 minutos    | Gráficos de mes/año                |

**Refresh manual (datos históricos):**

```sql
CALL refresh_continuous_aggregate('equipo_1min', '2026-01-01', '2026-01-08');
CALL refresh_continuous_aggregate('equipo_5min', '2026-01-01', '2026-01-08');
```

---

## Mapeo de registros

### `reg_map`

Define cómo interpretar cada campo de `equipo.data` para un sitio.

| Columna          | Tipo           | Descripción                                                          |
| ---------------- | -------------- | -------------------------------------------------------------------- |
| `id`             | varchar(20) PK |                                                                      |
| `alias`          | varchar(100)   | Nombre legible del registro                                          |
| `d1`             | varchar(20)    | Clave primaria en el JSONB de `equipo.data`                          |
| `d2`             | varchar(20)    | Clave secundaria (para registros de 32bit = dos palabras)            |
| `tipo_dato`      | varchar(20)    | Tipo de valor (`int`, `float`, etc.)                                 |
| `unidad`         | varchar(20)    | Unidad física (`L/s`, `m`, `m³`, etc.)                               |
| `rol_dashboard`  | varchar(40)    | Rol semántico: `caudal`, `totalizador`, `nivel_freatico`, `generico` |
| `transformacion` | varchar(40)    | `directo`, `word_swap`, `scale`, etc.                                |
| `parametros`     | jsonb          | Config de transformación (ver abajo)                                 |
| `sitio_id`       | FK → sitio     |                                                                      |

**Parámetros JSONB comunes:**

```json
{
  "scale_factor": 10,
  "word_swap": true,
  "totalizator_offset": 5000,
  "sensor_known_defective": false,
  "frozen_window_n": 5
}
```

---

## Pipeline DGA

### `pozo_config`

Configuración de pozos con reporte DGA. 1:1 con `sitio` (PK = sitio_id).

| Columna                    | Tipo                | Descripción                                                                         |
| -------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `sitio_id`                 | varchar(10) PK FK   |                                                                                     |
| `profundidad_pozo_m`       | numeric             | Profundidad total del pozo                                                          |
| `profundidad_sensor_m`     | numeric             | Profundidad del sensor                                                              |
| `nivel_estatico_manual_m`  | numeric             | Nivel estático ingresado manualmente                                                |
| `obra_dga`                 | varchar(80)         | Código de obra DGA en SNIA                                                          |
| `dga_activo`               | boolean             | **Switch maestro.** FALSE = no pre-seedea, no rellena, no envía                     |
| `dga_transport`            | varchar(10)         | `off` = pausado / `shadow` = rellena sin enviar / `rest` = envía a SNIA             |
| `dga_caudal_max_lps`       | numeric(10,2)       | Caudal máximo declarado (L/s)                                                       |
| `dga_caudal_tolerance_pct` | numeric(5,2)        | % tolerancia sobre caudal máximo (default 20%)                                      |
| `dga_periodicidad`         | varchar(10)         | `hora` / `dia` / `semana` / `mes`                                                   |
| `dga_fecha_inicio`         | date                | Inicio del periodo de reporte                                                       |
| `dga_informante_rut`       | FK → dga_informante | RUT del responsable que firma envíos                                                |
| `dga_max_retry_attempts`   | smallint            | Reintentos máximos antes de `fallido` (default 7)                                   |
| `dga_last_run_at`          | timestamptz         | Último ciclo de fill exitoso                                                        |
| `dga_gcs_export`           | boolean             | Si exporta a Google Cloud Storage (Parquet)                                         |
| `ficha_critica`            | jsonb               | Datos críticos del sitio: `{pin_critico, contactos[], acreditaciones[], riesgos[]}` |

### `dato_dga` — hypertable

Un **slot** = un período de reporte DGA (generalmente 1 hora).

| Columna               | Tipo                   | Descripción                                                        |
| --------------------- | ---------------------- | ------------------------------------------------------------------ |
| `site_id`             | varchar(10) FK → sitio |                                                                    |
| `ts`                  | timestamptz NOT NULL   | Timestamp UTC del período                                          |
| `fecha`               | date (generada)        | `ts` en hora Chile (UTC-4)                                         |
| `hora`                | time (generada)        | `ts` en hora Chile (UTC-4)                                         |
| `obra`                | varchar(150)           | Código obra DGA                                                    |
| `caudal_instantaneo`  | numeric(12,3)          | L/s                                                                |
| `flujo_acumulado`     | numeric(14,3)          | m³ acumulado (entero truncado)                                     |
| `nivel_freatico`      | numeric(8,3)           | metros                                                             |
| `estatus`             | varchar(20)            | Estado del slot (ver flujo abajo)                                  |
| `comprobante`         | text                   | Número de comprobante SNIA                                         |
| `intentos`            | smallint               | Cantidad de intentos de envío                                      |
| `next_retry_at`       | timestamptz            | Próximo reintento (NULL = inmediato)                               |
| `fail_reason`         | text                   | Último mensaje de error                                            |
| `validation_warnings` | jsonb                  | Array de anomalías detectadas: `[{code, raw, suggested?, reason}]` |

**Flujo de estado (`estatus`):**

```
vacio → pendiente → enviando → enviado
          ↓
    requires_review (validación falla — revisión manual)
          ↓
       pendiente (tras corrección manual)

enviando → rechazado → pendiente (retry, 1/día por Res. 2170 §6.2)
                    → fallido (tras N intentos)
```

**PK:** `(site_id, ts)` — un solo slot por sitio por período.

### `dga_informante`

RUT y datos del responsable que firma los envíos DGA. FK desde `pozo_config.dga_informante_rut`.

### `dga_send_audit`

Log de cada intento de envío a SNIA: timestamp, respuesta, error.

### `dga_gcs_export_log`

Log de exportaciones a Google Cloud Storage (Parquet).

---

## Otros módulos

### Alertas

- `alertas` — reglas de alerta por sitio (umbral, condición)
- `alertas_eventos` — instancias activadas de una alerta

### Incidencias

- `incidencias` — incidencias reportadas por sitio/empresa
- `incidencia_tecnicos` — técnicos asignados a cada incidencia

### Salas frías (`cold_room_*`)

Módulo específico para monitoreo de temperatura en cámaras frigoríficas:

- `cold_room_alarm_rule` — reglas de alarma
- `cold_room_alarm_event` — eventos
- `cold_room_threshold` — umbrales
- `cold_room_defrost_window` — ventanas de descongelamiento
- `cold_room_deviation_ack` — reconocimiento de desvíos
- `cold_room_audit_log` — auditoría

### Operación

- `site_operacion_config` — configuración de turnos por sitio
- `site_contador_mensual` — contador mensual de variable (ej. caudal acumulado del mes)
- `contacto_operativo` — contactos de guardia/operación por sitio
- `sitio_equipo` — tabla de unión sitio ↔ equipo (en sentido de "equipo físico", no la hypertable)

### Usuarios y auditoría

- `usuario` — usuarios del sistema. FK a `empresa` (acceso por empresa)
- `audit_log` — log de acciones en el sistema
- `api_metrics` / `api_variable_metrics` — métricas de uso de la API

### Documentos

- `documentos` — archivos adjuntos por sitio/empresa (contratos, informes)
- `plc_commands` — comandos enviados a PLCs (log)

---

## Flujo de datos completo

```
Dispositivo Windows (csvprocessor)
  → gRPC :50051 → csvconsumer (Linux, Rust)
    → cola in-memory → flush batch → INSERT INTO equipo(time, id_serial, data)
      → trigger: descarta duplicados exactos
        → TimescaleDB: distribuye en chunks por tiempo

equipo
  → continuous aggregate equipo_1min (auto, tiempo real)
  → continuous aggregate equipo_5min (auto, tiempo real)
    → frontend: gráficos usan equipo_1min / equipo_5min
    → DGA worker (cada 60s): lee equipo_1min → llena dato_dga slots vacio → pendiente
      → submission worker: envía dato_dga pendiente → SNIA → enviado/rechazado
```

---

## Comandos útiles

```bash
# Ver registros por día para un rango
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
SELECT DATE(time), COUNT(*) FROM equipo
WHERE time >= '2026-07-10' AND time < '2026-07-14'
GROUP BY 1 ORDER BY 1;"

# Ver estado slots DGA de un sitio
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
SELECT estatus, COUNT(*) FROM dato_dga
WHERE site_id = 'TU_SITE_ID'
GROUP BY estatus;"

# Refresh manual de aggregates (tras inserción histórica)
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
CALL refresh_continuous_aggregate('equipo_1min', '2026-07-10', '2026-07-14');"

docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
CALL refresh_continuous_aggregate('equipo_5min', '2026-07-10', '2026-07-14');"

# Ver chunks de equipo (TimescaleDB)
docker exec emeltec-db psql -U postgres -d telemetry_platform -c "
SELECT chunk_name, range_start, range_end
FROM timescaledb_information.chunks
WHERE hypertable_name = 'equipo'
ORDER BY range_start DESC LIMIT 10;"
```

---

## Ver también

- [[incidente-2026-07-13-csvconsumer-reconexion]] — bug de reconexión PostgreSQL en csvconsumer
- [[incidente-2026-07-10-vm-caida]] — caída de VM Linux
