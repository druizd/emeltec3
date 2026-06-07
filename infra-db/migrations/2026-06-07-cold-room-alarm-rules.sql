-- Cold-room alarm rules + recipients + event log.
-- Sustento: alarmas configurables HACCP (T> X, T< X, HR, sin transmisión).

CREATE TABLE IF NOT EXISTS cold_room_alarm_rule (
  id VARCHAR(80) PRIMARY KEY,
  site_id VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metric VARCHAR(20) NOT NULL,
  op VARCHAR(4) NOT NULL,
  threshold NUMERIC NOT NULL,
  target_kind VARCHAR(10) NOT NULL,
  target_value VARCHAR(120),
  sustained_min INTEGER NOT NULL DEFAULT 0,
  severity VARCHAR(10) NOT NULL DEFAULT 'warn',
  notify_email BOOLEAN NOT NULL DEFAULT FALSE,
  notify_ui BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cold_room_alarm_rule_site
  ON cold_room_alarm_rule(site_id, enabled);

CREATE TABLE IF NOT EXISTS cold_room_alarm_recipient (
  id BIGSERIAL PRIMARY KEY,
  site_id VARCHAR(40) NOT NULL,
  email VARCHAR(250) NOT NULL,
  name VARCHAR(150),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_severity VARCHAR(10) NOT NULL DEFAULT 'warn',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, email)
);
CREATE INDEX IF NOT EXISTS idx_cold_room_alarm_recipient_site
  ON cold_room_alarm_recipient(site_id);

CREATE TABLE IF NOT EXISTS cold_room_alarm_event (
  id BIGSERIAL PRIMARY KEY,
  site_id VARCHAR(40) NOT NULL,
  rule_id VARCHAR(80) NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  current_value NUMERIC,
  target_label VARCHAR(200),
  email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  email_recipients TEXT
);
CREATE INDEX IF NOT EXISTS idx_cold_room_alarm_event_rule_open
  ON cold_room_alarm_event(rule_id)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cold_room_alarm_event_site
  ON cold_room_alarm_event(site_id, triggered_at DESC);
