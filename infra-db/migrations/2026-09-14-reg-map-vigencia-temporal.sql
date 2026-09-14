-- ============================================================================
--  VIGENCIA TEMPORAL EN reg_map
-- ============================================================================
--
--  PROBLEMA
--  --------
--  `reg_map` tiene UNA sola `transformacion` y UN solo juego de `parametros`
--  por variable, para toda la historia. Cuando el instrumento cambia de escala
--  a mitad de la serie -- un recambio de equipo, o una rectificacion en
--  terreno -- no hay forma de expresar "hasta el 12 de julio factor 0.01,
--  desde el 12 de julio factor 1".
--
--  Corregir el factor arregla un tramo y rompe el otro. Ya nos mordio en
--  S127, S128, S130 y S148.
--
--  CASO TESTIGO (S148, Weir Esco / Elecmetal, Pozo Colina):
--  el totalizador venia contando en 0,01 m3 (10 L) y en julio 2026 se
--  rectifico a m3. El historico quedo inflado 100x -- ~100.000 m3/mes contra
--  ~950 reales. Confirmado cruzando el caudal (AI24), que es una variable
--  independiente y no se toco: antes del corte `caudal ~= totalizador / 100`,
--  despues `caudal ~= totalizador * 1`.
--
--
--  SOLUCION
--  --------
--  NO se agrega un factor con fecha dentro de la misma fila. Se permite que
--  convivan VARIAS filas de reg_map para la misma variable fisica, cada una
--  con su ventana de vigencia y sus propios parametros.
--
--  Eso encaja con lo que el codigo ya hace: `aggregateCounterRows`
--  (modules/contadores/service.ts) ya suma las filas de distintos
--  `variable_id` para un mismo periodo, porque es el resto tipico de un
--  recambio. El mes partido sale bien solo -- el mapeo viejo aporta sus
--  buckets previos al corte y el nuevo los posteriores.
--
--
--  SEMANTICA
--  ---------
--      vigente_desde   NULL = abierto hacia atras (siempre vigente antes)
--      vigente_hasta   NULL = abierto hacia adelante (vigente hasta hoy)
--
--  Intervalo SEMIABIERTO `[desde, hasta)`, igual que los rangos de mes del
--  resto del codigo (getMonthRangeChile). Asi dos ventanas contiguas no
--  solapan en el instante del corte: la muestra exacta de las 14:32:00 cae en
--  la ventana nueva, no en las dos.
--
--  RETROCOMPATIBLE: las filas existentes quedan NULL/NULL = siempre vigentes.
--  Sin ventanas configuradas el comportamiento es identico al de hoy.
--
--
--  OJO CON `CREATE TABLE IF NOT EXISTS`
--  ------------------------------------
--  No agrega columnas a una tabla que ya existe. Por eso esto va como ALTER
--  explicito y no tocando la definicion original de la tabla: si no, la
--  columna nunca llega a produccion y falla en silencio.
-- ============================================================================

ALTER TABLE reg_map ADD COLUMN IF NOT EXISTS vigente_desde TIMESTAMPTZ;
ALTER TABLE reg_map ADD COLUMN IF NOT EXISTS vigente_hasta TIMESTAMPTZ;

COMMENT ON COLUMN reg_map.vigente_desde IS
  'Inicio de vigencia del mapeo (inclusive). NULL = sin limite hacia atras.';
COMMENT ON COLUMN reg_map.vigente_hasta IS
  'Fin de vigencia del mapeo (EXCLUSIVE). NULL = vigente hasta hoy.';

-- Una ventana invertida no es un mapeo raro, es un error de carga: dejaria la
-- variable sin ningun instante vigente y la serie muda, sin nada que lo
-- explique. Falla al escribir, no al leer.
ALTER TABLE reg_map DROP CONSTRAINT IF EXISTS reg_map_vigencia_coherente;
ALTER TABLE reg_map ADD CONSTRAINT reg_map_vigencia_coherente
  CHECK (
    vigente_desde IS NULL
    OR vigente_hasta IS NULL
    OR vigente_desde < vigente_hasta
  );

-- El filtro por vigencia corre por sitio (el resolver de roles y los
-- contadores traen todos los mapeos del sitio y despues eligen), asi que el
-- indice util es el compuesto, no uno por columna.
CREATE INDEX IF NOT EXISTS idx_reg_map_sitio_vigencia
  ON reg_map (sitio_id, vigente_desde, vigente_hasta);

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'reg_map'
  AND column_name IN ('vigente_desde', 'vigente_hasta')
ORDER BY column_name;
