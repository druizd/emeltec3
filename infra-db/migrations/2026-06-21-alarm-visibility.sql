-- Visibilidad de alarmas: compartidas por sitio, pero con control de quién las ve.
-- Default: visible para todo el sitio (visible_to_all = TRUE). Si se restringe,
-- visible_to_all = FALSE y viewer_user_ids lista los usuarios autorizados.
-- Admin/Gerente/SuperAdmin ven todas; el filtro aplica solo a otros roles.
-- Aplica a AMBOS sistemas: cold_room_alarm_rule (cámaras) y alertas (agua/general).

ALTER TABLE cold_room_alarm_rule
  ADD COLUMN IF NOT EXISTS visible_to_all BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS viewer_user_ids VARCHAR(10)[] NOT NULL DEFAULT '{}';

ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS visible_to_all BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS viewer_user_ids VARCHAR(10)[] NOT NULL DEFAULT '{}';
