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

-- El CREATE TABLE de arriba es IF NOT EXISTS: en cualquier instalacion donde la
-- tabla YA existia (produccion, creada por la version previa de esta migracion)
-- es no-op, asi que las columnas declaradas ahi despues nunca aparecieron.
-- `lease_until` ya se habia parchado con su propio ALTER; `delivery_attempts` se
-- quedo sin el, y el poller de linux-db-api (src/main.rs, cada 5 s) venia
-- fallando con `column "delivery_attempts" does not exist`: 17.280 errores por
-- dia en el log de Postgres y, peor, ningun comando PLC llegaba a entregarse.
ALTER TABLE plc_commands ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_plc_commands_status
ON plc_commands(status, requested_at);

CREATE INDEX IF NOT EXISTS idx_plc_commands_delivery
ON plc_commands(status, lease_until, requested_at);

CREATE INDEX IF NOT EXISTS idx_plc_commands_device
ON plc_commands(id_serial, requested_at);
