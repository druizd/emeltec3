const db = require('../src/config/db');

async function migrate() {
  try {
    console.log('Agregando preferencias de autenticacion por usuario...');
    await db.query(`
      ALTER TABLE usuario
      ADD COLUMN IF NOT EXISTS password_login_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS otp_login_enabled BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
    `);

    console.log('Preferencias de autenticacion listas.');
    process.exit(0);
  } catch (err) {
    console.error('Error en migracion de preferencias de autenticacion:', err);
    process.exit(1);
  }
}

migrate();
