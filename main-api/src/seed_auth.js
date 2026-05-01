const db = require('./config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function seed() {
  try {
    console.log("Iniciando migración y siembra de seguridad...");

    // 1. Añadir columnas si no existen
    await db.query(`
      ALTER TABLE usuario 
      ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
      ADD COLUMN IF NOT EXISTS otp_hash VARCHAR(255),
      ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
    `);
    console.log("Columna password_hash verificada en usuario.");

    // 2. Generar el Hash común para todos (1234)
    const saltRounds = 10;
    const defaultPassword = '1234';
    const hashedPassword = await bcrypt.hash(defaultPassword, saltRounds);

    // 3. Crear identificadores aleatorios (o fijos)
    const superAdminId = 'U' + crypto.randomBytes(3).toString('hex');
    const adminId = 'U' + crypto.randomBytes(3).toString('hex');
    const clienteId = 'U' + crypto.randomBytes(3).toString('hex');

    // 4. Inyectar Usuarios base (Con ON CONFLICT para reiniciar contraseñas si existen)
    await db.query(`
      INSERT INTO usuario (id, nombre, apellido, email, tipo, empresa_id, password_hash)
      VALUES 
        ($1, 'Jefe', 'Maestro', 'superadmin@gmail.com', 'SuperAdmin', NULL, $4),
        ($2, 'Administrador', 'Empresarial', 'admin@gmail.com', 'Admin', 'E100', $4),
        ($3, 'Observador', 'Visual', 'cliente@gmail.com', 'Cliente', 'E100', $4)
      ON CONFLICT (email) 
      DO UPDATE SET password_hash = EXCLUDED.password_hash, tipo = EXCLUDED.tipo;
    `, [superAdminId, adminId, clienteId, hashedPassword]);

    console.log("¡Siembra de Usuarios completada exitosamente!");
    console.log("Credenciales inyectadas:");
    console.log(" - superadmin@gmail.com : 1234");
    console.log(" - admin@gmail.com      : 1234");
    console.log(" - cliente@gmail.com    : 1234");

  } catch (error) {
    console.error("Error durante la siembra:", error);
  } finally {
    process.exit(0);
  }
}

seed();
