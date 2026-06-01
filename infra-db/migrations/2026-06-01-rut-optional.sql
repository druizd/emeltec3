-- 2026-06-01 — RUT opcional en empresa y sub_empresa.
--
-- Antes: `empresa.rut` y `sub_empresa.rut` eran `NOT NULL UNIQUE`. Esto obligaba
-- a ingresar un RUT al crear cualquier empresa, pero hay casos (maletas piloto,
-- cuentas internas, pruebas) donde el RUT no existe o no aplica todavía.
--
-- Cambio: quitamos `NOT NULL`. Mantenemos el `UNIQUE` — en Postgres los NULL se
-- consideran distintos entre sí, así que varias empresas pueden quedar sin RUT
-- sin violar la unicidad, pero dos RUT iguales siguen prohibidos.
--
-- El backend ahora guarda NULL (no string vacío) cuando el RUT viene vacío, para
-- no colisionar contra el índice UNIQUE.
--
-- IDEMPOTENCIA: `DROP NOT NULL` es no-op si la columna ya es nullable, así que es
-- seguro re-aplicar en cada deploy.

ALTER TABLE empresa ALTER COLUMN rut DROP NOT NULL;
ALTER TABLE sub_empresa ALTER COLUMN rut DROP NOT NULL;
