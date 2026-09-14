-- ============================================================================
--  S148 -- PARTIR EL TOTALIZADOR EN SUS DOS ESCALAS
-- ============================================================================
--
--  Requiere 2026-09-14-reg-map-vigencia-temporal.sql aplicada.
--
--  EL SITIO
--  --------
--  S148 = Weir Esco / Elecmetal, "Pozo", Colina. Serial 151.21.49.126.
--  Declara a DGA bajo la obra OB-1301-937.
--
--
--  QUE PASO
--  --------
--  El totalizador venia contando en 0,01 m3 (10 L) y el `reg_map` lo leia con
--  `factor: 1`, o sea como si fueran m3. El 13 de julio de 2026 se rectifico el
--  medidor en terreno -- NO hubo recambio de equipo -- y desde entonces cuenta
--  en m3. El mismo mapeo quedo entonces a caballo entre dos escalas: el
--  historico mostraba ~100.000 m3/mes contra ~950 reales.
--
--
--  COMO SE CONFIRMO
--  ----------------
--  Con el caudal (AI24), que es una variable independiente y no se toco.
--  Integrado mes a mes sobre `equipo_1min` da el volumen real, y cae encima del
--  ÷100 del totalizador viejo -- y encima del totalizador nuevo sin dividir:
--
--      mes       totalizador   ÷100     caudal integrado
--      2026-01   122.293       1.222,9  1.201,6
--      2026-02    91.269         912,7    912,2
--      2026-03    88.495         885,0    905,4
--      2026-04   132.856       1.328,6  1.305,5
--      2026-05    99.339         993,4    985,2
--      2026-08       970       (ya m3)    935,6
--      2026-09       431       (ya m3)    416,3
--
--  Y la prueba mas limpia esta dentro de la propia hora del corte: entre las
--  13:09 y las 14:05 UTC del 13-07 el datalogger leyo ALTERNADAMENTE los dos
--  contadores en el mismo par de registros, y los dos avanzaron a la vez.
--  La serie alta subio 288 cuentas (x0,01 = 2,88 m3/h) y la baja 3 cuentas
--  (x1 = 3,0 m3/h): misma agua, unidades 100x aparte.
--
--
--  POR QUE HAY UN HUECO DE 57 MINUTOS
--  ----------------------------------
--  Justamente por esa lectura alternada no existe un instante que separe las
--  dos series: durante esa hora estan intercaladas minuto a minuto. Si el mapeo
--  nuevo arrancara en la primera lectura baja (13:09), leeria tambien las 35
--  lecturas ALTAS que vienen despues, con factor 1: saltos de 58.513 a
--  5.747.354 y vuelta, que ningun filtro de dips salva.
--
--  Asi que cada ventana se corta en su ultima lectura limpia y la hora de la
--  intervencion queda sin cubrir por ningun mapeo. Se pierden ~2,9 m3 sobre los
--  ~905 del mes: 0,32%. Es preferible un hueco honesto a un salto inventado.
--
--      viejo   hasta 13:09 UTC   (ultima lectura limpia 13:08, 5.747.330)
--      nuevo   desde 14:06 UTC   (primera sin altas,        58.516)
--
--
--  POR QUE EL MAPEO VIEJO CONSERVA EL ID
--  -------------------------------------
--  `site_contador_mensual.variable_id` referencia `reg_map` con ON DELETE
--  CASCADE, y todas las filas del historico cuelgan de RMF259B339. Dejandolo
--  como el tramo VIEJO, esas filas se quedan donde estan y el backfill las
--  recalcula con el factor correcto. El tramo nuevo estrena id y sus propias
--  filas; `aggregateCounterRows` suma las dos por periodo, que es lo que ya
--  hacia para los recambios.
--
--
--  DESPUES DE APLICAR ESTO
--  -----------------------
--      docker exec -i -e DB_STATEMENT_TIMEOUT_MS=120000 emeltec-api \
--        node scripts/backfill-contadores-mensuales.js --sitio=S148 --meses=12
--
--  OJO: el backfill escribe mes a mes SIN transaccion, de mas viejo a mas
--  nuevo. Si aborta deja meses ya reescritos -- verificar con `actualizado_at`.
--  Despues, el cache Redis `contadores:*` tiene TTL 900s.
--
--  Esperado tras el backfill (m3): ene 1.223 / feb 913 / mar 885 / abr 1.329 /
--  may 993 / jun 1.134 / jul ~900 (suma de los dos tramos) / ago 970.
--
--  NO toca `dato_dga`: los unicos slots que existen son de agosto y septiembre,
--  todos en `pendiente` y ya calculados con la escala nueva, que es la correcta.
--  Nunca se envio nada a SNIA desde la plataforma.
-- ============================================================================

BEGIN;

-- 1. El mapeo existente pasa a ser el TRAMO VIEJO: escala 0,01 m3 y ventana
--    cerrada en la primera lectura del contador nuevo.
UPDATE reg_map
   SET parametros    = parametros || '{"factor": 0.01}'::jsonb,
       vigente_desde = NULL,
       vigente_hasta = TIMESTAMPTZ '2026-07-13 13:09:00+00'
 WHERE id      = 'RMF259B339'
   AND sitio_id = 'S148';

-- 2. El TRAMO NUEVO: mismos registros y mismo rol, factor 1, desde el fin de la
--    intervencion. Copia el resto de la definicion del viejo para que no se
--    puedan desincronizar (word_swap incluido, que aca es imprescindible).
INSERT INTO reg_map (
  id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion,
  parametros, sitio_id, vigente_desde, vigente_hasta
)
SELECT
  'RM148A0713',
  r.alias,
  r.d1,
  r.d2,
  r.tipo_dato,
  r.unidad,
  r.rol_dashboard,
  r.transformacion,
  r.parametros || '{"factor": 1}'::jsonb,
  r.sitio_id,
  TIMESTAMPTZ '2026-07-13 14:06:00+00',
  NULL
FROM reg_map r
WHERE r.id = 'RMF259B339'
  AND r.sitio_id = 'S148'
ON CONFLICT (id) DO UPDATE
  SET parametros    = EXCLUDED.parametros,
      vigente_desde = EXCLUDED.vigente_desde,
      vigente_hasta = EXCLUDED.vigente_hasta;

-- Red de seguridad: si el mapeo origen existe pero algo del UPDATE o del INSERT
-- fallara en silencio, el sitio quedaria a medias -- leyendo parte de su
-- historico con la escala equivocada y sin nada que lo delate.
--
-- Pero solo donde el sitio EXISTE. El CI aplica todas las migraciones sobre una
-- base recien creada, y ahi el UPDATE no afecta filas y el INSERT ... SELECT no
-- inserta ninguna: esta migracion es un no-op legitimo, no un error. Lo mismo
-- vale para una instalacion nueva o un entorno de desarrollo.
DO $$
DECLARE
  totalizadores INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM reg_map WHERE id = 'RMF259B339' AND sitio_id = 'S148'
  ) THEN
    RAISE NOTICE 'S148/RMF259B339 no existe en esta base: migracion sin efecto.';
    RETURN;
  END IF;

  SELECT count(*) INTO totalizadores
    FROM reg_map
   WHERE sitio_id = 'S148'
     AND rol_dashboard = 'totalizador';

  IF totalizadores <> 2 THEN
    RAISE EXCEPTION 'S148 deberia quedar con 2 mapeos de totalizador, quedo con %', totalizadores;
  END IF;
END $$;

COMMIT;

-- Verificación
SELECT id, alias, d1, d2, transformacion, parametros, vigente_desde, vigente_hasta
FROM reg_map
WHERE sitio_id = 'S148'
ORDER BY vigente_desde NULLS FIRST;
