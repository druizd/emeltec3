-- 2026-09-02 — Destinatarios por regla de alerta.
--
-- Hasta ahora `notificarUsuarios` (modules/alerts/worker.ts) mandaba el correo
-- de cada evento a una lista fija: todos los SuperAdmin más quien creó la
-- regla. No había forma de elegir quién recibe una alerta, y `visible_to_all`
-- / `viewer_user_ids` controlan quién la VE, no quién es notificado.
--
--   notificar_user_ids     → usuarios (usuario.id) que reciben el correo.
--   notificar_superadmins  → además avisa al equipo Emeltec (tipo SuperAdmin).
--
-- COMPATIBILIDAD: con la lista vacía el worker conserva el comportamiento
-- anterior (avisa al creador), así que las reglas existentes no cambian de
-- destinatarios al aplicar esta migración.
--
-- DOWN-MIGRATION:
--   ALTER TABLE alertas DROP COLUMN IF EXISTS notificar_user_ids;
--   ALTER TABLE alertas DROP COLUMN IF EXISTS notificar_superadmins;

BEGIN;

ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS notificar_user_ids VARCHAR(10)[] NOT NULL DEFAULT '{}';

ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS notificar_superadmins BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
