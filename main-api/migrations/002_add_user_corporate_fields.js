const db = require('../src/config/db');

async function migrate() {
  try {
    console.log('Actualizando tabla usuario con campos corporativos...');
    // Añadimos apellido, rut_usuario (para no confundir con rut de empresa) y telefono
    await db.query(`
      ALTER TABLE usuario 
      ADD COLUMN IF NOT EXISTS apellido VARCHAR(100),
      ADD COLUMN IF NOT EXISTS rut_usuario VARCHAR(20),
      ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);
    `);
    console.log('Campos añadidos con éxito.');
    process.exit(0);
  } catch (err) {
    console.error('Error en la migración:', err);
    process.exit(1);
  }
}

migrate();
