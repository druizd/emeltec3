CREATE TABLE IF NOT EXISTS plc_commands (
    id BIGSERIAL PRIMARY KEY,
    command_id TEXT NOT NULL UNIQUE,
    id_serial TEXT NOT NULL,
    tag TEXT NOT NULL,
    value TEXT NOT NULL,
    command_type TEXT NOT NULL DEFAULT 'write_tag',
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    lease_until TIMESTAMPTZ,
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ,
    error TEXT,
    response JSONB
);

ALTER TABLE plc_commands ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_plc_commands_status
ON plc_commands(status, requested_at);

CREATE INDEX IF NOT EXISTS idx_plc_commands_delivery
ON plc_commands(status, lease_until, requested_at);

CREATE INDEX IF NOT EXISTS idx_plc_commands_device
ON plc_commands(id_serial, requested_at);
