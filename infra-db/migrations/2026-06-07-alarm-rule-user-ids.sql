-- Cambiar destinatarios de email arbitrario a referencia a usuario(id).
-- Más simple: usuario debe existir en la plataforma; admin gestiona usuarios del sitio.

ALTER TABLE cold_room_alarm_rule
  DROP COLUMN IF EXISTS recipient_ids,
  ADD COLUMN IF NOT EXISTS recipient_user_ids VARCHAR(10)[] NOT NULL DEFAULT '{}';

-- Tabla `cold_room_alarm_recipient` deprecada — reemplazada por referencia directa a usuario.
DROP TABLE IF EXISTS cold_room_alarm_recipient;
