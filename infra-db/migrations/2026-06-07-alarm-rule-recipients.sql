-- Per-rule recipient selection (opción B simplificada).
-- Cada regla guarda explícitamente qué destinatarios reciben email.

ALTER TABLE cold_room_alarm_rule
  ADD COLUMN IF NOT EXISTS recipient_ids BIGINT[] NOT NULL DEFAULT '{}';
