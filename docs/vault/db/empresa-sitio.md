# Jerarquía empresa → sitio

---

## `empresa`

Empresa cliente (ej. CCU, ENAP, Codelco).

| Columna        | Tipo                 | Descripción                                |
| -------------- | -------------------- | ------------------------------------------ |
| `id`           | `varchar(10) PK`     | Código corto (ej. `"CCU"`)                 |
| `nombre`       | `varchar(150)`       | Nombre completo                            |
| `rut`          | `varchar(20) UNIQUE` | RUT empresa                                |
| `tipo_empresa` | `varchar(50)`        | Controla el módulo en sidebar del frontend |
| `sitios`       | `integer DEFAULT 0`  | Contador de sitios activos                 |

**Valores de `tipo_empresa`:**

| Valor         | Módulo frontend      | Icono        |
| ------------- | -------------------- | ------------ |
| `'Agua'`      | Consumo de Agua      | `water_drop` |
| `'Riles'`     | Generación de Riles  | `waves`      |
| `'Proceso'`   | Variables de Proceso | `memory`     |
| `'Eléctrico'` | Consumo Eléctrico    | `bolt`       |

---

## `sub_empresa`

División o planta dentro de una empresa (ej. "Planta Norte").

FK: `empresa_id → empresa.id ON DELETE CASCADE`

---

## `sitio`

Instalación monitoreada — pozo, medidor de agua, sala fría, etc.

| Columna            | Tipo                         | Descripción                                                                 |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------- |
| `id`               | `varchar(10) PK`             | Código corto                                                                |
| `descripcion`      | `varchar(255)`               | Nombre legible para el frontend                                             |
| `id_serial`        | `varchar(50)`                | **Clave de enlace con `equipo`** — identifica el dispositivo Windows        |
| `empresa_id`       | `FK → empresa`               |                                                                             |
| `sub_empresa_id`   | `FK → sub_empresa`           |                                                                             |
| `tipo_sitio`       | `varchar(30) DEFAULT 'pozo'` | `'pozo'`, `'medidor'`, etc.                                                 |
| `activo`           | `boolean DEFAULT true`       | Si aparece en sidebar/dashboard                                             |
| `coord_norte`      | `numeric(12,2)`              | UTM northing (metros, WGS84)                                                |
| `coord_este`       | `numeric(12,2)`              | UTM easting (metros, WGS84)                                                 |
| `huso`             | `smallint`                   | Zona UTM. Chile: 18 (norte), 19 (centro), 20 (sur)                          |
| `es_maleta_piloto` | `boolean DEFAULT false`      | Override visual: agrupa bajo "Maletas Piloto" en sidebar sin alterar lógica |

**Tablas que referencian `sitio.id`:**
`dato_dga`, `pozo_config`, `reg_map`, `alertas`, `incidencias`, `documentos`, `contacto_operativo`, `site_operacion_config`, `site_contador_mensual`, `sitio_equipo`

---

## `pozo_config`

Config específica de pozo con reporte DGA. Relación 1:1 con `sitio` (PK = `sitio_id`).

| Columna                    | Tipo                        | Descripción                                                               |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `sitio_id`                 | `varchar(10) PK FK → sitio` |                                                                           |
| `profundidad_pozo_m`       | `numeric`                   | Profundidad total del pozo                                                |
| `profundidad_sensor_m`     | `numeric`                   | Profundidad del sensor                                                    |
| `nivel_estatico_manual_m`  | `numeric`                   | Nivel estático ingresado manualmente                                      |
| `obra_dga`                 | `varchar(80)`               | Código de obra en SNIA                                                    |
| `dga_activo`               | `boolean DEFAULT false`     | **Switch maestro.** FALSE = nada de DGA funciona                          |
| `dga_transport`            | `varchar(10) DEFAULT 'off'` | `off` / `shadow` / `rest`                                                 |
| `dga_caudal_max_lps`       | `numeric(10,2)`             | Caudal máximo declarado (L/s)                                             |
| `dga_caudal_tolerance_pct` | `numeric(5,2) DEFAULT 20`   | % tolerancia sobre caudal máximo                                          |
| `dga_periodicidad`         | `varchar(10)`               | `hora` / `dia` / `semana` / `mes`                                         |
| `dga_fecha_inicio`         | `date`                      | Inicio del período de reporte                                             |
| `dga_informante_rut`       | `FK → dga_informante`       | RUT del responsable que firma envíos                                      |
| `dga_max_retry_attempts`   | `smallint DEFAULT 7`        | Reintentos antes de `fallido`                                             |
| `dga_last_run_at`          | `timestamptz`               | Último ciclo de fill exitoso                                              |
| `dga_gcs_export`           | `boolean DEFAULT false`     | Exportar a Google Cloud Storage (Parquet)                                 |
| `ficha_critica`            | `jsonb DEFAULT '{}'`        | Datos críticos: `{pin_critico, contactos[], acreditaciones[], riesgos[]}` |

**Modos `dga_transport`:**

- `off` — DGA pausado. No rellena ni envía
- `shadow` — Rellena `dato_dga` pero no envía a SNIA
- `rest` — Rellena y envía a SNIA. Activar requiere 2FA en el backend

---

## `sitio_equipo`

Tabla de unión entre sitio y equipamiento físico (no confundir con la hypertable `equipo`).

---

## `site_contador_mensual`

Contador mensual acumulado de una variable por sitio (ej. caudal del mes en m³).

FK: `sitio_id → sitio`, `variable_id → reg_map`

---

## `site_operacion_config`

Config de turnos y operación por sitio (horarios, responsables, etc.).

---

## Ver también

- [[equipo]] — tabla raw de telemetría (enlaza por `id_serial`)
- [[dato-dga]] — slots DGA (enlaza por `site_id`)
- [[reg-map]] — mapeo de registros por sitio
- [[../main-api/auth]] — control de acceso por empresa/sub_empresa
