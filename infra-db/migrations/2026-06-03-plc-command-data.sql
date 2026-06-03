ALTER TABLE plc_commands
ADD COLUMN IF NOT EXISTS data jsonb;
