/**
 * 2026-09-15 — Módulo RILes, fase 2: laboratorio.
 *
 * El balance de la fase 1 dice cuánta agua sale. Esto dice con qué sale. Las
 * dos mitades se cruzan en un solo número, la **carga contaminante en kg**:
 * concentración × volumen del período. Por eso el laboratorio no es un módulo
 * aparte — sin el volumen de `riles_fuente`/contadores, una concentración en
 * mg/L no se puede comparar contra un límite de carga ni sumar en el mes.
 *
 * Cuatro tablas:
 *
 *   riles_parametro          catálogo global (DBO5, SST, pH, …). Lo siembra
 *                            esta migración; no es por sitio ni por cliente.
 *   riles_limite             el límite de UN sitio para UN parámetro bajo UNA
 *                            norma, con vigencia. Un cambio de norma se
 *                            expresa con dos filas de ventanas disjuntas.
 *   riles_muestra            un muestreo: fecha, laboratorio, N° de informe.
 *   riles_muestra_resultado  un valor por parámetro dentro de esa muestra.
 *
 * Tres decisiones que el esquema fija a propósito:
 *
 * 1. **No todo parámetro tiene carga.** El pH es logarítmico y la temperatura
 *    es intensiva: multiplicarlos por m³ no da kg de nada. `aplica_carga` lo
 *    marca en el catálogo en vez de dejar que el cálculo lo adivine.
 * 2. **Un límite puede tener piso y techo.** El pH se pasa por abajo (5,5) y
 *    por arriba (9,0); la DBO5 sólo por arriba. Dos columnas nullable, no una.
 * 3. **La unidad viaja con el dato, no se asume.** Un metal en µg/L comparado
 *    contra un límite en mg/L da un veredicto mil veces malo sin que nada se
 *    queje — el mismo accidente que la fase 1 evitó normalizando a m³.
 *
 * Ver docs/riles-propuesta-modulo.md §6.
 * Idempotente.
 */
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'timescaledb',
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || 'postgres',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
});

const SQL = `
-- ── riles_parametro ──────────────────────────────────────────────────────────
-- Catálogo global de parámetros de calidad. No cuelga del sitio: el DBO5 es el
-- mismo para todos, lo que cambia por sitio es el LÍMITE (riles_limite).
CREATE TABLE IF NOT EXISTS riles_parametro (
  codigo       VARCHAR(30)  PRIMARY KEY,
  nombre       VARCHAR(80)  NOT NULL,
  unidad       VARCHAR(20)  NOT NULL,
  aplica_carga BOOLEAN      NOT NULL DEFAULT TRUE,
  grupo        VARCHAR(30)  NOT NULL DEFAULT 'general',
  orden        SMALLINT     NOT NULL DEFAULT 100,
  activo       BOOLEAN      NOT NULL DEFAULT TRUE
);

-- CREATE TABLE IF NOT EXISTS no altera una tabla que ya existe.
ALTER TABLE riles_parametro ADD COLUMN IF NOT EXISTS aplica_carga BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE riles_parametro ADD COLUMN IF NOT EXISTS grupo        VARCHAR(30) NOT NULL DEFAULT 'general';
ALTER TABLE riles_parametro ADD COLUMN IF NOT EXISTS orden        SMALLINT    NOT NULL DEFAULT 100;
ALTER TABLE riles_parametro ADD COLUMN IF NOT EXISTS activo       BOOLEAN     NOT NULL DEFAULT TRUE;

COMMENT ON TABLE riles_parametro IS
  'Catalogo global de parametros de calidad de RILes. El limite por sitio y '
  'norma vive en riles_limite.';
COMMENT ON COLUMN riles_parametro.aplica_carga IS
  'FALSE para parametros que no son una concentracion masica: pH (logaritmico), '
  'temperatura (intensiva), coliformes (recuento), poder espumogeno (altura). '
  'Multiplicarlos por m3 no da kg de nada, asi que la carga queda en NULL.';
COMMENT ON COLUMN riles_parametro.unidad IS
  'Unidad canonica del parametro. Un resultado cargado en otra unidad se '
  'convierte a esta antes de comparar y antes de calcular la carga.';

-- ── riles_limite ─────────────────────────────────────────────────────────────
-- El limite de un sitio para un parametro bajo una norma, con vigencia.
CREATE TABLE IF NOT EXISTS riles_limite (
  id             BIGSERIAL     PRIMARY KEY,
  sitio_id       VARCHAR(10)   NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
  parametro      VARCHAR(30)   NOT NULL REFERENCES riles_parametro(codigo) ON DELETE RESTRICT,
  norma          VARCHAR(10)   NOT NULL,
  tipo           VARCHAR(20)   NOT NULL DEFAULT 'concentracion',
  limite_min     NUMERIC(16,6),
  limite_max     NUMERIC(16,6),
  unidad         VARCHAR(20)   NOT NULL,
  vigencia_desde DATE          NOT NULL,
  vigencia_hasta DATE,
  nota           TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT riles_limite_tipo_chk CHECK (tipo IN ('concentracion', 'carga')),
  CONSTRAINT riles_limite_norma_chk CHECK (norma IN ('ds90', 'ds46', 'ds609', 'rca')),
  -- Una fila sin piso ni techo no limita nada y dejaria un veredicto mudo.
  CONSTRAINT riles_limite_algun_valor_chk CHECK (limite_min IS NOT NULL OR limite_max IS NOT NULL),
  CONSTRAINT riles_limite_orden_chk CHECK (limite_min IS NULL OR limite_max IS NULL OR limite_max >= limite_min),
  CONSTRAINT riles_limite_vigencia_chk CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

-- Mismo criterio que riles_fuente: el mismo limite puede existir dos veces con
-- ventanas distintas (cambio de RCA), pero no dos veces con la misma ventana.
CREATE UNIQUE INDEX IF NOT EXISTS riles_limite_uniq
  ON riles_limite (sitio_id, parametro, norma, tipo, vigencia_desde);
CREATE INDEX IF NOT EXISTS idx_riles_limite_sitio ON riles_limite (sitio_id);

COMMENT ON TABLE riles_limite IS
  'Limite de un sitio para un parametro bajo una norma, con vigencia. Un '
  'cambio de limite se expresa con dos filas de ventanas disjuntas, nunca '
  'editando la vigente: reescribirla cambiaria veredictos ya emitidos.';
COMMENT ON COLUMN riles_limite.tipo IS
  'concentracion = mg/L y equivalentes; carga = kg por periodo. Un sitio puede '
  'tener los dos para el mismo parametro.';
COMMENT ON COLUMN riles_limite.limite_min IS
  'Piso. Solo el pH y la temperatura lo usan en la practica; el resto es NULL.';

-- ── riles_muestra ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riles_muestra (
  id            BIGSERIAL    PRIMARY KEY,
  sitio_id      VARCHAR(10)  NOT NULL REFERENCES sitio(id) ON DELETE CASCADE,
  fecha_muestra DATE         NOT NULL,
  tipo          VARCHAR(20)  NOT NULL DEFAULT 'autocontrol',
  laboratorio   VARCHAR(120),
  n_informe     VARCHAR(60),
  punto         VARCHAR(80),
  documento_id  BIGINT       REFERENCES documentos(id) ON DELETE SET NULL,
  nota          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(50),
  CONSTRAINT riles_muestra_tipo_chk CHECK (tipo IN ('autocontrol', 'fiscalizacion', 'interna'))
);

-- El N° de informe identifica el muestreo de forma unica dentro del sitio, pero
-- es opcional: una muestra interna puede no tener informe. Indice parcial para
-- que los NULL no choquen entre si.
CREATE UNIQUE INDEX IF NOT EXISTS riles_muestra_informe_uniq
  ON riles_muestra (sitio_id, n_informe) WHERE n_informe IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_riles_muestra_sitio_fecha
  ON riles_muestra (sitio_id, fecha_muestra DESC);

COMMENT ON TABLE riles_muestra IS
  'Un muestreo del efluente. El PDF del laboratorio se cuelga de documentos '
  'via documento_id; ON DELETE SET NULL para que borrar el PDF no borre el '
  'resultado analitico.';
COMMENT ON COLUMN riles_muestra.fecha_muestra IS
  'Fecha de la TOMA de la muestra, no la del informe. Es la que decide contra '
  'que volumen se calcula la carga y que limite estaba vigente.';

-- ── riles_muestra_resultado ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riles_muestra_resultado (
  id         BIGSERIAL     PRIMARY KEY,
  muestra_id BIGINT        NOT NULL REFERENCES riles_muestra(id) ON DELETE CASCADE,
  parametro  VARCHAR(30)   NOT NULL REFERENCES riles_parametro(codigo) ON DELETE RESTRICT,
  valor      NUMERIC(16,6) NOT NULL,
  unidad     VARCHAR(20)   NOT NULL,
  bajo_ld    BOOLEAN       NOT NULL DEFAULT FALSE,
  nota       TEXT,
  CONSTRAINT riles_resultado_valor_chk CHECK (valor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS riles_resultado_uniq
  ON riles_muestra_resultado (muestra_id, parametro);

COMMENT ON TABLE riles_muestra_resultado IS
  'Un valor por parametro dentro de una muestra.';
COMMENT ON COLUMN riles_muestra_resultado.bajo_ld IS
  'TRUE cuando el laboratorio informo "< LD": el valor guardado es el limite de '
  'deteccion, no una medicion. La carga que sale de ahi es una COTA SUPERIOR y '
  'viaja marcada como tal.';

-- ── Catalogo ─────────────────────────────────────────────────────────────────
-- Siembra del catalogo global. Es un catalogo de sistema, asi que la migracion
-- lo mantiene al dia (DO UPDATE); 'activo' no se toca, es decision del operador.
INSERT INTO riles_parametro (codigo, nombre, unidad, aplica_carga, grupo, orden) VALUES
  ('ph',                  'pH',                            'upH',        FALSE, 'fisicoquimico',  10),
  ('temperatura',         'Temperatura',                   '°C',         FALSE, 'fisicoquimico',  20),
  ('conductividad',       'Conductividad',                 'µS/cm',      FALSE, 'fisicoquimico',  30),
  ('sst',                 'Sólidos suspendidos totales',   'mg/L',       TRUE,  'fisicoquimico',  40),
  ('sedimentables',       'Sólidos sedimentables',         'mL/L/h',     FALSE, 'fisicoquimico',  50),
  ('dbo5',                'DBO5',                          'mg/L',       TRUE,  'organico',       60),
  ('dqo',                 'DQO',                           'mg/L',       TRUE,  'organico',       70),
  ('aceites_grasas',      'Aceites y grasas',              'mg/L',       TRUE,  'organico',       80),
  ('hidrocarburos',       'Hidrocarburos totales',         'mg/L',       TRUE,  'organico',       90),
  ('saam',                'Detergentes (SAAM)',            'mg/L',       TRUE,  'organico',      100),
  ('poder_espumogeno',    'Poder espumógeno',              'mm',         FALSE, 'organico',      110),
  ('n_total',             'Nitrógeno total Kjeldahl',      'mg/L',       TRUE,  'nutriente',     120),
  ('n_amoniacal',         'Nitrógeno amoniacal',           'mg/L',       TRUE,  'nutriente',     130),
  ('nitrito_nitrato',     'Nitrito + nitrato',             'mg/L',       TRUE,  'nutriente',     140),
  ('p_total',             'Fósforo total',                 'mg/L',       TRUE,  'nutriente',     150),
  ('cloruros',            'Cloruros',                      'mg/L',       TRUE,  'inorganico',    160),
  ('sulfatos',            'Sulfatos',                      'mg/L',       TRUE,  'inorganico',    170),
  ('sulfuros',            'Sulfuros',                      'mg/L',       TRUE,  'inorganico',    180),
  ('cianuro',             'Cianuro',                       'mg/L',       TRUE,  'inorganico',    190),
  ('fluoruro',            'Fluoruro',                      'mg/L',       TRUE,  'inorganico',    200),
  ('boro',                'Boro',                          'mg/L',       TRUE,  'inorganico',    210),
  ('aluminio',            'Aluminio',                      'mg/L',       TRUE,  'metal',         220),
  ('arsenico',            'Arsénico',                      'mg/L',       TRUE,  'metal',         230),
  ('cadmio',              'Cadmio',                        'mg/L',       TRUE,  'metal',         240),
  ('cobre',               'Cobre',                         'mg/L',       TRUE,  'metal',         250),
  ('cromo_total',         'Cromo total',                   'mg/L',       TRUE,  'metal',         260),
  ('cromo_hexavalente',   'Cromo hexavalente',             'mg/L',       TRUE,  'metal',         270),
  ('hierro',              'Hierro disuelto',               'mg/L',       TRUE,  'metal',         280),
  ('manganeso',           'Manganeso',                     'mg/L',       TRUE,  'metal',         290),
  ('mercurio',            'Mercurio',                      'mg/L',       TRUE,  'metal',         300),
  ('molibdeno',           'Molibdeno',                     'mg/L',       TRUE,  'metal',         310),
  ('niquel',              'Níquel',                        'mg/L',       TRUE,  'metal',         320),
  ('plomo',               'Plomo',                         'mg/L',       TRUE,  'metal',         330),
  ('selenio',             'Selenio',                       'mg/L',       TRUE,  'metal',         340),
  ('zinc',                'Zinc',                          'mg/L',       TRUE,  'metal',         350),
  ('coliformes_fecales',  'Coliformes fecales',            'NMP/100mL',  FALSE, 'microbiologico',360)
ON CONFLICT (codigo) DO UPDATE SET
  nombre       = EXCLUDED.nombre,
  unidad       = EXCLUDED.unidad,
  aplica_carga = EXCLUDED.aplica_carga,
  grupo        = EXCLUDED.grupo,
  orden        = EXCLUDED.orden;
`;

async function migrate() {
  try {
    console.log('[migration 014] riles laboratorio (parametro/limite/muestra/resultado)...');
    await pool.query(SQL);
    console.log('[migration 014] OK');
    process.exit(0);
  } catch (err) {
    console.error('[migration 014] ERROR:', err);
    process.exit(1);
  }
}

migrate();
