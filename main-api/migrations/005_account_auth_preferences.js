const db = require('../src/config/db');

const SQL = `
ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'usuario'
      AND column_name = 'password_login_enabled'
  ) THEN
    EXECUTE $sql$
      UPDATE usuario
      SET auth_mode = CASE
        WHEN two_factor_enabled IS TRUE THEN 'password_otp'
        WHEN password_login_enabled IS TRUE THEN 'password'
        WHEN otp_login_enabled IS TRUE THEN 'otp'
        ELSE COALESCE(auth_mode, 'password')
      END
      WHERE auth_mode IS NULL
    $sql$;
  ELSE
    UPDATE usuario
    SET auth_mode = COALESCE(auth_mode, 'password')
    WHERE auth_mode IS NULL;
  END IF;
END $$;

ALTER TABLE usuario
  ALTER COLUMN auth_mode SET DEFAULT 'password',
  ALTER COLUMN auth_mode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuario_auth_mode_check'
  ) THEN
    ALTER TABLE usuario
      ADD CONSTRAINT usuario_auth_mode_check
      CHECK (auth_mode IN ('password', 'otp', 'password_otp'));
  END IF;
END $$;

ALTER TABLE usuario
  DROP COLUMN IF EXISTS password_login_enabled,
  DROP COLUMN IF EXISTS otp_login_enabled,
  DROP COLUMN IF EXISTS two_factor_enabled;
`;

async function migrate() {
  try {
    console.log('Agregando preferencias de autenticacion por usuario...');
    await db.query(SQL);

    console.log('Preferencias de autenticacion listas.');
    process.exit(0);
  } catch (err) {
    console.error('Error en migracion de preferencias de autenticacion:', err);
    process.exit(1);
  }
}

migrate();
