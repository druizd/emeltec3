# Módulo RILes

**Cliente que lo gatilla:** Doñihue (`E113`). Hoy esa empresa sólo tiene el pozo
`S142` con reporte DGA (`OB-1306-883`, `dga_transport='rest'`).

**Qué es:** el tipo de sitio `riles` — que existía con una vista de demostración —
convertido en un módulo real, con el **balance hídrico pozo→ril** como primer
entregable y el espacio ya reservado para los parámetros de laboratorio.

**Estado:** fases 0 y 1 implementadas (ver [§10 Plan](#10-plan)). Falta la
configuración del sitio real de Doñihue, que depende de las respuestas de
[§11](#11-lo-que-falta-preguntarle-a-doñihue).

---

## 1. De dónde se parte

El tipo `riles` ya estaba declarado de punta a punta, pero no calculaba nada:

| Dónde                                                                   | Qué hay                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `main-api/src/config/siteTypeCatalog.js`                                | Tipo `riles` con roles caudal, totalizador, nivel, presión, pH, conductividad, temperatura |
| `frontend-angular/src/app/shared/site-type-ui.ts`                       | Módulo "Generación de Riles", icono `waves`, verde `#22c55e`, ruta `riles`                 |
| `frontend-angular/src/app/app.routes.ts`                                | Ruta `companies/:siteId/riles`                                                             |
| `frontend-angular/src/app/pages/companies/company-site-riles-detail.ts` | Vista de 911 líneas: copia en verde de la de pozos                                         |
| `docs/vault/db/empresa-sitio.md`                                        | `tipo_empresa = 'Riles'` ya mapea al módulo del sidebar                                    |

La vista leía telemetría real (`getSiteDashboardData` + `getTelemetryPreset`) pero
mostraba KPIs de nivel/caudal/totalizador, una "banda Manning" inventada (un
`0.78`/`1.22` multiplicando la serie de caudal), un badge que decía **"Equipo
simulado: RILES-DEMO-01"**, un botón "Descargar mes activo (.xlsx)" que no hacía
nada, y rellenaba los huecos con valores fabricados: el nivel con `0,01` y la
calidad del sensor con 99 % cuando no llegaba lectura. De los roles del catálogo,
pH, conductividad y temperatura no se mostraban en ninguna parte.

El volumen mensual salía de `max(totalizador) − min(totalizador)` sobre las
lecturas crudas del rango: eso ignora los resets del contador y los recambios de
medidor, que es justo lo que el módulo `contadores` ya tiene resuelto.

No existía ningún vínculo entre sitios: ni en base de datos, ni en la API, ni en
la UI.

---

## 2. Decisiones tomadas

| Decisión               | Resuelto                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Qué se calcula primero | **Balance hídrico**: m³ que entran por los pozos vs m³ que salen como RIL, y el coeficiente de descarga |
| Laboratorio            | No entra en la primera fase, pero **el modelo de datos lo deja listo** (§6): se agrega sin migrar nada  |
| Origen del caudal      | **Configurable por sitio**: medidor propio, derivado de los sitios ligados, o mixto                     |
| Normativa              | **Tabla de límites configurable**, con DS 90, DS 46 y DS 609 soportados. Doñihue se define después      |

### Sobre la palabra "masa"

El balance de la fase 1 se lleva en **m³**, no en kg: la masa de agua es el
volumen por la densidad y no aporta información. La masa aparece de verdad en la
fase 2, como **carga contaminante**:

```
carga [kg] = volumen del período [m³] × concentración [mg/L] / 1000
```

Esa fórmula necesita las dos mitades: el volumen lo entrega la fase 1, la
concentración la entrega el laboratorio. Por eso el orden — la fase 1 no es un
paso previo opcional, es el denominador de todo lo que viene después.

---

## 3. El vínculo entre sitios

Un sitio RILes se liga a **uno o más sitios fuente** (pozos, vertientes, canales
u otros RILes). Cada vínculo declara:

- **qué sitio** aporta,
- **qué rol** se lee de ese sitio (`totalizador` por defecto),
- **un factor** de prorrateo,
- **una dirección** (entrada al balance o salida),
- **desde y hasta cuándo** rige.

El factor cubre el caso normal: un pozo que abastece dos plantas entra al balance
de cada una con 0,5, o con la proporción real si se conoce. **El factor es
prorrateo y nada más.** El coeficiente de descarga es otra cosa y vive en
`riles_config.coef_descarga_esperado_pct`: es del sitio, no del vínculo, y meter
los dos en el mismo número haría imposible saber cuál se está mirando.

La vigencia no es opcional. Un pozo deja de abastecer la planta, se reemplaza un
medidor, cambia el prorrateo: sin `vigencia_desde`/`vigencia_hasta` cada cambio
de configuración reescribe el histórico completo hacia atrás. El repo ya tiene el
precedente en `infra-db/migrations/2026-09-14-reg-map-vigencia-temporal.sql` y la
función `isMappingVigenteAt` de `modules/sites/transforms.ts`.

### Reglas duras

1. **Una fuente tiene que ser de la misma subempresa.** No es una validación
   cosmética: ligar un pozo de otro cliente expone su volumen extraído en la
   pantalla de este. Es el mismo riesgo que cuida `ensureSerialAvailable` con los
   seriales compartidos.
2. **Sin ciclos ni autorreferencia.** RILes A → RILes B → RILes A se rechaza en el
   `POST`, no se descubre en producción. El chequeo es un `WITH RECURSIVE` que
   pregunta si el sitio fuente ya alcanza, directa o indirectamente, al sitio
   RILes; la recursión se corta a 10 saltos por seguridad. Encadenar RILes sí se
   permite: un punto final que agrupa puntos parciales es un caso legítimo.
3. **Un sitio fuente puede alimentar varios RILes.** El UNIQUE es por
   `(riles_sitio_id, fuente_sitio_id, rol, vigencia_desde)`, no por la fuente
   sola.

---

## 4. Modelo de datos

Espejo deliberado de `pozo_config`: misma forma, tabla aparte. **RILes no se
declara a la DGA** — es SISS/SMA —, así que meterlo en `pozo_config` mezclaría
dos ciclos regulatorios que no tienen nada que ver.

```sql
-- Config 1:1 del sitio RILes
CREATE TABLE IF NOT EXISTS riles_config (
  sitio_id                   varchar(10) PRIMARY KEY REFERENCES sitio(id) ON DELETE CASCADE,
  modo_caudal                varchar(10)  NOT NULL DEFAULT 'propio',   -- propio | derivado | mixto
  coef_descarga_esperado_pct numeric(5,2),                             -- banda esperada del balance
  coef_tolerancia_pct        numeric(5,2) NOT NULL DEFAULT 15,
  norma                      varchar(10),                              -- ds90 | ds46 | ds609 | rca | NULL
  punto_descarga             varchar(80),                              -- codigo del punto / N resolucion
  caudal_max_autorizado_lps  numeric(10,2),                            -- linea de limite en el grafico
  volumen_max_mensual_m3     numeric(14,2),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- Vinculo N:M con los sitios que alimentan el balance
CREATE TABLE IF NOT EXISTS riles_fuente (
  id              bigserial PRIMARY KEY,
  riles_sitio_id  varchar(10) NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
  fuente_sitio_id varchar(10) NOT NULL REFERENCES sitio(id) ON DELETE RESTRICT,
  rol             varchar(30) NOT NULL DEFAULT 'totalizador',
  factor          numeric(8,4) NOT NULL DEFAULT 1,
  direccion       varchar(10)  NOT NULL DEFAULT 'entrada',  -- entrada | salida
  vigencia_desde  date NOT NULL,
  vigencia_hasta  date,                                     -- NULL = vigente
  nota            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT riles_fuente_no_autoref CHECK (riles_sitio_id <> fuente_sitio_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS riles_fuente_uniq
  ON riles_fuente (riles_sitio_id, fuente_sitio_id, rol, vigencia_desde);
CREATE INDEX IF NOT EXISTS riles_fuente_por_sitio ON riles_fuente (riles_sitio_id);
```

> **`ON DELETE RESTRICT` en `fuente_sitio_id` es a propósito.** Si el pozo se
> borra en cascada, el balance histórico del RIL queda sin explicación y nadie se
> entera. Que falle el borrado y obligue a cerrar la vigencia primero.

> **Recordatorio de migraciones:** `CREATE TABLE IF NOT EXISTS` no agrega
> columnas a una tabla que ya existe. Cualquier campo que se sume después va con
> su propio `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, o no llega a producción y
> falla en silencio.

---

## 5. El cálculo

### De dónde sale el volumen

**No se recalcula desde `equipo`.** El módulo `contadores`
(`main-api/src/modules/contadores/`) ya resuelve exactamente este problema para
cualquier sitio y cualquier rol de tipo contador (`totalizador`, `energia`,
`volumen`): materializa `site_contador_mensual` y `site_contador_diario`,
detecta resets por overflow uint32 y por recambio de medidor, aplica la
transformación del `reg_map` y filtra muestras corruptas.

El balance es una **suma sobre esas tablas**, no un recorrido del hypertable.

```
V_entrada(p) = Σ  delta(fuente, rol, p) × factor(fuente, p)   [direccion = 'entrada']
V_salida(p)  = Σ  delta(fuente, rol, p) × factor(fuente, p)   [direccion = 'salida']
             + delta(sitio_riles, 'totalizador', p)           [si modo_caudal ∈ propio, mixto]

coeficiente(p)  = V_salida(p) / V_entrada(p) × 100
consumo_neto(p) = V_entrada(p) − V_salida(p)
```

En modo `derivado` no hay medidor en la descarga:
`V_salida = V_entrada × coef_descarga_esperado_pct / 100`. En ese modo el
coeficiente calculado es una tautología — devuelve el que se configuró — y por eso
cada punto viaja con `estimado: true` y la pantalla lo rotula. Un balance estimado
no puede mostrarse como si fuera medido.

`mixto` usa el medidor propio en los períodos que tienen lectura y cae al estimado
en los que no; el período estimado queda además marcado como incompleto, porque se
esperaba una medición que no llegó.

### Granularidad y zona horaria

Mes y día, ambos en `America/Santiago` (nunca `Etc/GMT+4`: en invierno coinciden
y el desfase se vuelve invisible justo hasta que deja de serlo). El día es el día
calendario chileno, igual que en `site_contador_diario`.

### Qué se muestra cuando falta un pedazo

Si una fuente no tiene dato en el período, el balance **no** asume cero: marca el
período como incompleto y muestra qué fuente faltó. Un coeficiente de 40 % porque
un pozo dejó de transmitir es peor que no mostrar nada, porque parece un dato.

### El worker diario no arrancaba

`main-api/src/server.js` arrancaba `startContadoresWorker` (mensual) y nada más:
el `daily-worker.ts` del mismo módulo no se importaba en ningún lado, así que
`site_contador_diario` estaba vacía en toda la base.

No era un bloqueo funcional — `getDailySeries` tiene un fallback que recomputa el
día contra el hypertable cuando la fila materializada no existe, y por eso el
balance diario igual respondía. Era un problema de costo: cada request del balance
diario recorría `equipo` para cada fuente y cada día del rango.

El worker quedó cableado en `server.js` con su propio kill switch
(`ENABLE_CONTADORES_DAILY_WORKER`, por defecto `false` dentro del worker), así que
prenderlo en producción es una variable de entorno, no un despliegue.

---

## 6. El espacio para el laboratorio

No se construye ahora. Se define ahora para que entre después sin mover nada de
lo anterior:

| Tabla                     | Qué guarda                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `riles_parametro`         | Catálogo: DBO5, SST, N total, P total, aceites y grasas, pH, temperatura… con unidad |
| `riles_limite`            | Límite por `(sitio, parámetro, norma)` con vigencia. Concentración o carga           |
| `riles_muestra`           | Un muestreo: fecha, laboratorio, N° de informe, tipo (autocontrol / fiscalización)   |
| `riles_muestra_resultado` | Un valor por parámetro, con marca de "bajo el límite de detección"                   |

El informe de laboratorio en PDF se cuelga de la tabla `documentos` que ya
existe, no de un campo nuevo.

Con eso, la carga sale de cruzar `riles_muestra_resultado` con el volumen del
período que ya calcula la fase 1. **Lo único que la fase 1 tiene que respetar**
es que el volumen por período sea consultable por rango arbitrario de fechas, no
sólo por mes cerrado: una muestra es de un día, y la carga se compara contra el
volumen de ese día o de esa jornada.

`riles_config.norma` se crea desde la fase 1 aunque todavía no haya límites: es
lo que después decide qué tabla de límites aplica.

---

## 7. API

Bajo el prefijo que ya usan los sitios (`/api/companies/sites/:siteId/...`):

| Método            | Ruta                      | Quién             |
| ----------------- | ------------------------- | ----------------- |
| `GET`             | `.../riles/config`        | Lectura del sitio |
| `PUT`             | `.../riles/config`        | Admin, SuperAdmin |
| `GET`             | `.../riles/fuentes`       | Lectura del sitio |
| `POST` / `DELETE` | `.../riles/fuentes[/:id]` | Admin, SuperAdmin |
| `GET`             | `.../riles/balance`       | Lectura del sitio |

`GET .../riles/balance?desde=&hasta=&granularidad=dia|mes` devuelve, por período:
`volumen_entrada_m3`, `volumen_salida_m3`, `coeficiente_pct`, `consumo_neto_m3`,
`completo` (bool) y el **detalle por fuente**, que es lo que permite explicar un
coeficiente raro sin salir de la pantalla.

El `DELETE` de una fuente **cierra la vigencia**, no borra la fila. Borrarla
cambiaría el histórico que el cliente ya vio.

---

## 8. La vista

La vista pasó de demo a real y ganó pestañas, al estilo de la de pozos
(`DetailTab` en `company-site-water-detail.ts`):

| Pestaña        | Contenido                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Monitoreo**  | Nivel de cámara, caudal y volumen del mes, **+ pH, conductividad y temperatura** cuando el sitio los tiene mapeados   |
| **Balance**    | Tarjetas de entrada / salida / coeficiente / neto, tabla por período con barra de proporción, y el detalle por fuente |
| **Calidad**    | Fase 2. Queda con estado vacío explícito que dice qué va a ir ahí, no oculta                                          |
| **Alertas**    | Reusa `water-detail-alertas`                                                                                          |
| **Bitácora**   | Reusa `water-detail-bitacora`                                                                                         |
| **Configurar** | `riles_config` + el editor de fuentes + `site-variable-settings-panel`                                                |

En Monitoreo, **una tarjeta sólo aparece si el sitio mide esa variable**. La
vista anterior rellenaba los huecos (nivel en `0,01`, calidad en 99 %), que es
peor que no mostrar la tarjeta.

### Lo que se sacó

- El badge **"Equipo simulado: RILES-DEMO-01"** — ahora muestra el serial real, o
  dice que no hay equipo asociado.
- La **"banda Manning"**: era un `0.78`/`1.22` multiplicando la serie de caudal,
  no una banda calculada de nada. Con ella se fue la nota que la explicaba.
- El botón **"Descargar mes activo (.xlsx)"**, que no hacía nada. Vuelve en la
  fase 3, conectado a `water-detail-descarga`.
- El volumen mensual calculado a mano sobre el crudo: ahora sale de
  `contadores-mensuales`, con los resets y recambios ya resueltos.

### Diseño

El módulo Riles ya tiene identidad en el design system: icono `waves`, verde
`#22c55e`. Ese verde es el acento del módulo — bordes, iconos, badges. Los
**valores numéricos van en JetBrains Mono teal (`text-primary-container`)** como
en el resto de la plataforma.

Etiquetas de métrica en ALL CAPS, 10px: `VOL. ENTRADA [M3]`, `VOL. DESCARGA [M3]`,
`COEF. DESCARGA [%]`. Fechas `DD/MM/YYYY HH:MM`.

---

## 9. Qué se reutiliza

Casi todo. Esto es lo que hace que el módulo sea barato:

| Se reutiliza                        | Para qué                                          |
| ----------------------------------- | ------------------------------------------------- |
| `modules/contadores`                | Volumen por período, resets, recambios de medidor |
| `telemetry-line-chart-card`         | Los gráficos de serie                             |
| `water-detail-descarga`             | Export CSV/XLSX (ya acepta `dataTypeOptions`)     |
| `water-detail-bitacora` / `alertas` | Tal cual                                          |
| `site-variable-settings-panel`      | Mapeo de variables del sitio                      |
| `periodo-comparacion`               | Comparar mes contra mes                           |
| `documentos`                        | Los PDF de laboratorio en la fase 2               |

Lo genuinamente nuevo son dos tablas, un servicio de balance y una pestaña.

---

## 10. Plan

| Fase  | Qué                                                                                                                  | Estado    |
| ----- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| **0** | Cablear el `daily-worker` de contadores en `server.js`                                                               | ✅ hecho  |
| **1** | `riles_config` + `riles_fuente`, servicio de balance, endpoints, pestaña Balance, editor de fuentes, limpiar la demo | ✅ hecho  |
| **2** | Laboratorio: catálogo de parámetros, límites por norma, muestras, cargas en kg, alerta por superación                | pendiente |
| **3** | Informe mensual descargable (el botón que se sacó de la vista)                                                       | pendiente |

La fase 1 sirve sola: un cliente que no tiene análisis de laboratorio igual ve su
balance.

### Qué quedó en el repo

| Archivo                                                                 | Qué                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------- |
| `main-api/migrations/013_riles_config_fuente.js`                        | Las dos tablas. Corre sola al arrancar el contenedor |
| `main-api/src/modules/riles/balance.ts`                                 | La aritmética pura, sin infraestructura              |
| `main-api/src/modules/riles/service.ts`                                 | El IO: pide las series a contadores y las combina    |
| `main-api/src/modules/riles/repo.ts`                                    | CRUD + las validaciones de subempresa y de ciclos    |
| `main-api/src/modules/riles/controller.ts`                              | Los cinco endpoints, con zod                         |
| `main-api/src/modules/riles/__tests__/balance.test.ts`                  | 24 tests del cálculo                                 |
| `main-api/src/routes/companyRoutes.js`                                  | Montaje con `requireSiteAccess` + rol para escritura |
| `shared/src/riles.ts`                                                   | Los tipos que comparte el frontend                   |
| `frontend-angular/src/app/pages/companies/riles/`                       | Pestaña Balance y editor de config/fuentes           |
| `frontend-angular/src/app/pages/companies/company-site-riles-detail.ts` | Pestañas, meses desde contadores, demo fuera         |

### Cómo se prende el worker diario

No requiere despliegue: el worker ya está cableado y su kill switch es una
variable de entorno.

```bash
# en la VM, sobre el .env del main-api
ENABLE_CONTADORES_DAILY_WORKER=true
docker restart emeltec-api

# verificar que arrancó
docker logs emeltec-api --since 2m | grep contadores-daily
```

Debe aparecer `contadores-daily worker iniciado`. Si dice
`contadores-daily worker deshabilitado`, la variable no llegó al contenedor.

---

## 11. Lo que falta preguntarle a Doñihue

Ninguna de estas bloquea la fase 0 ni el modelo de datos. Sí bloquean poner el
sitio en producción:

1. **¿El RIL se mide o se estima?** Si hay caudalímetro en la descarga: marca,
   señal, registro Modbus. Si no, esto es modo `derivado` y hay que acordar el
   coeficiente con el cliente, por escrito.
2. **¿Qué pozos abastecen la planta?** ¿`S142` es el único? ¿Alimenta sólo a esta
   planta o hay que prorratear?
3. **¿Cuál es el coeficiente de descarga esperado y su banda?** Es lo que decide
   cuándo el balance dispara una alerta.
4. **¿A dónde descarga?** Alcantarillado (DS 609), cauce (DS 90) o infiltración
   (DS 46). Y el número de la resolución o del punto de descarga.
5. **¿Hay autocontrol de laboratorio hoy?** Frecuencia, laboratorio, parámetros.
   Define el alcance real de la fase 2.
6. **¿Qué período cierra el informe?** Mes calendario o período tarifario de la
   sanitaria; no siempre coinciden.

---

## 12. Lo que esta propuesta decide NO hacer

- **No mete RILes en el pipeline DGA.** Otro regulador, otro ciclo, otras
  sanciones. `pozo_config` y `dato_dga` no se tocan.
- **No calcula el balance al vuelo desde `equipo`.** Sale de las tablas
  materializadas de contadores o no sale.
- **No infiere el vínculo entre sitios desde el nombre ni desde la subempresa.**
  El vínculo es explícito, con fecha, y alguien lo declara.
