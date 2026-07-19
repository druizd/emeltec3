# `reg_map` — Mapeo de registros Modbus

Define cómo interpretar cada campo del JSONB `equipo.data` para un sitio específico.

---

## Schema

| Columna          | Tipo                              | Descripción                                                 |
| ---------------- | --------------------------------- | ----------------------------------------------------------- |
| `id`             | `varchar(20) PK`                  | ID del registro                                             |
| `alias`          | `varchar(100)`                    | Nombre legible (ej. "Caudal instantáneo")                   |
| `d1`             | `varchar(20)`                     | Clave primaria en `equipo.data` (ej. `"D1"`)                |
| `d2`             | `varchar(20)`                     | Clave secundaria para registros 32bit (dos palabras Modbus) |
| `tipo_dato`      | `varchar(20)`                     | Tipo del valor raw (`int`, `float`, `uint32`, etc.)         |
| `unidad`         | `varchar(20)`                     | Unidad física (`L/s`, `m`, `m³`, `kW`, etc.)                |
| `rol_dashboard`  | `varchar(40) DEFAULT 'generico'`  | Rol semántico — qué representa este registro                |
| `transformacion` | `varchar(40) DEFAULT 'directo'`   | Transformación a aplicar al valor raw                       |
| `parametros`     | `jsonb DEFAULT '{}'`              | Config de transformación (ver detalle abajo)                |
| `sitio_id`       | `FK → sitio (ON DELETE SET NULL)` | Sitio al que pertenece                                      |

---

## `rol_dashboard`

Define el significado semántico del registro. El backend y el DGA worker usan este campo para identificar qué valor es qué:

| Valor            | Significado                              |
| ---------------- | ---------------------------------------- |
| `caudal`         | Caudal instantáneo en L/s                |
| `totalizador`    | Totalizador de flujo acumulado en m³     |
| `nivel_freatico` | Nivel freático en metros                 |
| `presion`        | Presión en bar/PSI                       |
| `temperatura`    | Temperatura                              |
| `generico`       | Variable sin rol especial (solo gráfico) |

---

## `transformacion`

| Valor       | Descripción                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `directo`   | Se usa el valor raw sin modificación                                      |
| `word_swap` | Intercambia las dos palabras de 16bit antes de componer el valor de 32bit |
| `scale`     | Divide por `scale_factor` del parámetro                                   |
| `ieee754`   | Interpreta los 32bits como float IEEE 754                                 |

---

## `parametros` JSONB — claves conocidas

```json
{
  "scale_factor": 10,
  "word_swap": true,
  "totalizator_offset": 5000,
  "totalizator_base_minus": 1000,
  "totalizator_base_plus": 2000,
  "sensor_known_defective": false,
  "frozen_window_n": 5
}
```

| Clave                         | Uso                                                                |
| ----------------------------- | ------------------------------------------------------------------ |
| `scale_factor`                | Divisor del valor raw (default 1)                                  |
| `word_swap`                   | Si invertir words en registro 32bit                                |
| `totalizator_offset`          | Offset fijo a sumar al totalizador                                 |
| `totalizator_base_minus/plus` | Ajuste de base del totalizador                                     |
| `sensor_known_defective`      | Si `true`, el DGA worker envía el slot a `requires_review` siempre |
| `frozen_window_n`             | N lecturas consecutivas para detectar sensor congelado (default 4) |

---

## Cómo se usa en el pipeline

```
equipo.data = {"D1": 24500, "D2": 0}
         ↓
reg_map: d1="D1", d2="D2", rol_dashboard="caudal",
         transformacion="scale", parametros={"scale_factor": 100}
         ↓
valor procesado = 24500 / 100 = 245.0 L/s
         ↓
DGA fill worker toma processed.caudal.valor = 245.0
```

---

## Índices

| Índice                            | Columnas                     |
| --------------------------------- | ---------------------------- |
| `idx_regmap_sitio`                | `sitio_id`                   |
| `idx_regmap_sitio_rol`            | `(sitio_id, rol_dashboard)`  |
| `idx_regmap_sitio_transformacion` | `(sitio_id, transformacion)` |

---

## Ver también

- [[equipo]] — tabla que contiene el JSONB `data` que se mapea aquí
- [[empresa-sitio]] — relación con `sitio`
- [[../main-api/dga-pipeline]] — cómo el DGA worker usa `rol_dashboard`
