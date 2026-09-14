-- Rollback del piloto "Sala de servicios" (S149, Kross Curacavi).
--
-- Devuelve el sitio EXACTAMENTE al estado que tenia antes de la migracion del
-- 14-09-2026. Los valores de abajo estan copiados del bloque ANTES que imprimio
-- esa migracion, no reconstruidos de memoria.
--
-- Correr esto ANTES de desplegar el codigo sin el tipo `sala_servicios`: si el
-- sitio queda con un tipo que la plataforma ya no conoce, cae en coming-soon.
--
-- Ver docs/sala-servicios-piloto-kross.md.
--
-- OJO: las escalas que restaura estaban MAL (las presiones x1000, el PT100
-- x100). Es a proposito: el trabajo de un rollback es dejar la base como
-- estaba. Si lo que se quiere es apagar la vista pero conservar las unidades
-- correctas, correr solo el UPDATE de `sitio` del final.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

\echo '== ANTES DEL ROLLBACK =='
SELECT id, alias, rol_dashboard, unidad, parametros::text
FROM reg_map WHERE sitio_id = 'S149' AND transformacion <> 'bit' ORDER BY alias;

-- --------------------------------------------------------------- reg_map
UPDATE reg_map SET
  alias = 'Ai0 entrada Mitsubishi', rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'ieee754_32',
  parametros = '{"factor": 1, "offset": 0, "formato": "float32", "word_swap": false}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RMDD7BD247';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'ieee754_32',
  parametros = '{"factor": 1, "offset": 0, "formato": "float32", "word_swap": false}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RMCF00E477';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'ieee754_32',
  parametros = '{"factor": 1, "offset": 0, "formato": "float32", "word_swap": false}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RMF2021162';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'ieee754_32',
  parametros = '{"factor": 1, "offset": 0, "formato": "float32", "word_swap": false}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RM0442472E';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'lineal',
  parametros = '{"factor": 1, "offset": 1}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RM0F20A047';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'lineal',
  parametros = '{"factor": 1.271132579128003, "offset": -5008.262361764332, "ing_max": 20000, "ing_min": 0, "raw_max": 19674, "raw_min": 3940, "modo_escala": "rango"}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RM6E802888';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'lineal',
  parametros = '{"factor": 10, "offset": 0}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RMEA35F15B';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'lineal',
  parametros = '{"factor": 10, "offset": 0}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RM8E32370E';

UPDATE reg_map SET
  rol_dashboard = 'generico', unidad = NULL,
  transformacion = 'lineal',
  parametros = '{"factor": 1, "offset": 0, "con_signo": true, "signo_bits": 16}'::jsonb
WHERE sitio_id = 'S149' AND id = 'RMF73E9EB2';

-- ----------------------------------------------------------------- sitio
UPDATE sitio SET tipo_sitio = 'pozo' WHERE id = 'S149';

\echo '== DESPUES DEL ROLLBACK =='
SELECT id, alias, rol_dashboard, unidad, transformacion, parametros::text
FROM reg_map WHERE sitio_id = 'S149' AND transformacion <> 'bit' ORDER BY alias;
SELECT id, descripcion, tipo_sitio FROM sitio WHERE id = 'S149';

COMMIT;
