-- FKs y constraints faltantes en cold-room tablas.

-- FK alarm_event → alarm_rule con CASCADE (al borrar regla, sus eventos se borran).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cold_room_alarm_event_rule'
  ) THEN
    -- Limpiar eventos huérfanos antes de aplicar FK.
    DELETE FROM cold_room_alarm_event e
      WHERE NOT EXISTS (
        SELECT 1 FROM cold_room_alarm_rule r WHERE r.id = e.rule_id
      );
    ALTER TABLE cold_room_alarm_event
      ADD CONSTRAINT fk_cold_room_alarm_event_rule
      FOREIGN KEY (rule_id) REFERENCES cold_room_alarm_rule(id) ON DELETE CASCADE;
  END IF;
END $$;

-- UNIQUE en defrost window (site + sala + id ya es id PK, pero (site, sala, startHHmm) puede duplicar).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'uniq_cold_room_defrost_site_sala_start'
  ) THEN
    CREATE UNIQUE INDEX uniq_cold_room_defrost_site_sala_start
      ON cold_room_defrost_window(site_id, sala_slug, start_hhmm);
  END IF;
END $$;
