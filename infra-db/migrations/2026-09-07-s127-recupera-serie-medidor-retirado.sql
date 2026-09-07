-- 2026-09-07 — S127 (Pozo 2, Agrosuper Faenadora San Vicente): recupera la
-- serie de totalizador anterior al recambio de caudalimetro del 30-08-2026.
--
-- QUE PASO
-- El 30-08-2026 10:19 se borraron los mapeos del equipo viejo (`AI23`,
-- `REG372`, `REG373`) al configurar el nuevo (`REG3001-3004`, ieee754).
-- `site_contador_mensual.variable_id` es `REFERENCES reg_map(id) ON DELETE
-- CASCADE`, asi que ese DELETE se llevo todas las filas mensuales del medidor
-- retirado. Resultado: Flujo Mensual/Semanal/Diario en blanco antes del 30-08 y
-- agosto mostrando 2.717 m3 (los 2 dias del medidor nuevo) en vez de ~47.000.
-- El crudo nunca se perdio: `equipo.data` y el cagg `equipo_1min` siguen con
-- `REG372`/`REG373` desde el 02-06-2026 18:58 hasta el 30-08-2026 14:26.
--
-- POR QUE `rol_dashboard = 'generico'` Y NO `'totalizador'`
-- `findHistoricalVariable` (main-api/src/services/siteTelemetryService.js:341-347
-- y su gemelo en modules/sites/service.ts) puntua 110 a un totalizador
-- `uint32_registros` contra 90 a uno `ieee754_32`, y el desempate "gana la que
-- si calculo" solo corre a igual puntaje. Un mapeo retirado con rol
-- `totalizador` le ganaria al medidor vigente y dejaria el totalizador y el
-- acumulado DGA en null — la misma falla que dejo 69 slots sin caudal en agosto.
-- Los graficos igual lo toman: la clausula EXISTS de
-- `listCounterVariablesForSiteAndRol` (main-api/src/modules/contadores/repo.ts:85-88)
-- incluye toda variable que ya tenga filas en `site_contador_mensual` con el
-- rol pedido, sin mirar `rol_dashboard`. El alias evita a proposito los tokens
-- `totalizador/totalizado/acumulado/volumen/volume/totalizer`, que le darian
-- puntaje al resolver por coincidencia de texto.
--
-- EL FACTOR 0.1 ESTA VERIFICADO
-- `(REG373 * 65536 + REG372) * 0.1` reproduce exactamente el `flujo_acumulado`
-- que `dato_dga` ya declaro a SNIA (contrastado en 6 horas de agosto), y da
-- 1.447-1.501 m3/dia — el mismo consumo diario que mide el equipo nuevo por su
-- cuenta (1.519 m3/dia en septiembre). Sin el factor serian 14.800 m3/dia.
--
-- IDEMPOTENCIA
-- El deploy corre esta carpeta completa en cada push a main, asi que los dos
-- INSERT van con ON CONFLICT DO NOTHING: una segunda pasada no duplica ni pisa
-- valores que el worker haya refinado despues. Y ambos estan guardados por la
-- existencia del sitio para no romper el CI, que aplica las migraciones sobre
-- una base vacia donde `S127` no existe.

BEGIN;

-- 1) El mapeo del medidor retirado. Sin el no hay donde colgar las filas
--    mensuales: `site_contador_mensual.variable_id` tiene FK a `reg_map`.
INSERT INTO reg_map
  (id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id)
SELECT 'RM372A0830', 'REG372 (retirado 30-08-2026)', 'REG372', 'REG373', 'INTEGER', 'm3',
       'generico', 'uint32_registros',
       '{"factor": 0.1, "offset": 0, "formato": "uint32", "word_swap": true}'::jsonb, 'S127'
 WHERE EXISTS (SELECT 1 FROM sitio WHERE id = 'S127')
ON CONFLICT (id) DO NOTHING;

-- 2) Los tres meses que el crudo alcanza a cubrir (jun/jul/ago 2026).
--
--    Replica `computeMonthDeltaForVariable` (contadores/service.ts:351):
--    misma fuente (`equipo_1min`), limites de mes con offset fijo -04:00 como
--    `getMonthRangeChile`, y delta = suma de incrementos positivos entre
--    muestras consecutivas — equivalente a su suma de segmentos con corte en
--    cada reset. El `prev` de la primera muestra de cada mes es la ultima del
--    mes anterior, que es el seed cross-month de ventana 7 dias; de ahi el
--    colchon del 25-05 en el rango leido.
--
--    No se usa `filterTransientDips` porque no hace falta: en jun-ago hay UN
--    solo retroceso, el re-base documentado del 02-06-2026
--    (8.008.138,1 -> 800.969,9 m3), y ningun dip transitorio que filtrar.
WITH s AS (SELECT id_serial FROM sitio WHERE id = 'S127'),
meses(mes, ini, fin) AS (VALUES
  (DATE '2026-06-01', TIMESTAMPTZ '2026-06-01 00:00:00-04', TIMESTAMPTZ '2026-07-01 00:00:00-04'),
  (DATE '2026-07-01', TIMESTAMPTZ '2026-07-01 00:00:00-04', TIMESTAMPTZ '2026-08-01 00:00:00-04'),
  (DATE '2026-08-01', TIMESTAMPTZ '2026-08-01 00:00:00-04', TIMESTAMPTZ '2026-09-01 00:00:00-04')
),
v AS (
  SELECT e.bucket,
         ((e.data->>'REG373')::numeric * 65536 + (e.data->>'REG372')::numeric) * 0.1 AS val
    FROM equipo_1min e, s
   WHERE e.id_serial = s.id_serial
     AND e.data ? 'REG372' AND e.data ? 'REG373'
     AND e.bucket >= TIMESTAMPTZ '2026-05-25 00:00:00-04'
     AND e.bucket <  TIMESTAMPTZ '2026-09-01 00:00:00-04'
),
w AS (SELECT bucket, val, lag(val) OVER (ORDER BY bucket) AS prev FROM v)
INSERT INTO site_contador_mensual
  (sitio_id, variable_id, rol, mes, valor_inicio, valor_fin, delta, unidad,
   muestras, resets_detectados, ultimo_dato)
SELECT 'S127', 'RM372A0830', 'totalizador', m.mes,
       (array_agg(w.val ORDER BY w.bucket))[1],
       (array_agg(w.val ORDER BY w.bucket DESC))[1],
       SUM(GREATEST(w.val - COALESCE(w.prev, w.val), 0)),
       'm3',
       count(*),
       count(*) FILTER (WHERE w.prev IS NOT NULL AND w.val < w.prev),
       max(w.bucket)
  FROM meses m
  JOIN w ON w.bucket >= m.ini AND w.bucket < m.fin
 GROUP BY m.mes
ON CONFLICT (sitio_id, variable_id, mes) DO NOTHING;

COMMIT;

-- Verificacion (valores esperados en produccion al 07-09-2026):
--   jun-2026  delta 40.800,7 m3  ·  40.624 muestras  ·  1 reset
--   jul-2026  delta 44.965,9 m3  ·  44.559 muestras  ·  0 resets
--   ago-2026  delta 44.438,8 m3  ·  42.386 muestras  ·  0 resets
-- y agosto pasa a sumar 44.438,8 + 2.717,2 = 47.156,0 m3 entre los dos equipos.
--
-- SELECT mes,
--        string_agg(variable_id || '=' || round(delta, 1), ' + ' ORDER BY variable_id),
--        round(SUM(delta), 1) AS total_m3
--   FROM site_contador_mensual
--  WHERE sitio_id = 'S127' AND rol = 'totalizador' AND delta IS NOT NULL
--  GROUP BY mes ORDER BY mes;
--
-- Rollback: DELETE FROM reg_map WHERE id = 'RM372A0830';
-- (el ON DELETE CASCADE se lleva las tres filas mensuales)
