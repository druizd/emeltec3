const db = require('../src/config/db');

async function migrate() {
  try {
    console.log('Iniciando migración de tabla usuario...');
    await db.query(
      'ALTER TABLE usuario ADD COLUMN IF NOT EXISTS sub_empresa_id VARCHAR(50) REFERENCES sub_empresa(id)',
    );
    console.log('Columna sub_empresa_id añadida con éxito.');
    process.exit(0);
  } catch (err) {
    console.error('Error en la migración:', err);
    process.exit(1);
  }
}

migrate();
