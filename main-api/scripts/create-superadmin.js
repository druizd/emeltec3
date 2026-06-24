/**
 * Crea (o promueve) un usuario SuperAdmin.
 *
 * Pensado para correr DENTRO del contenedor main-api (tiene pg + bcrypt + red
 * a la BD vía DB_* del entorno del contenedor):
 *
 *   docker compose exec main-api node scripts/create-superadmin.js \
 *     <email> "<Nombre>" "<Apellido>" [password]
 *
 * - Si el email ya existe → lo promueve a SuperAdmin y resetea la contraseña.
 * - Si no se pasa password → genera una temporal fuerte y la imprime UNA vez.
 * - La contraseña se guarda como hash bcrypt (cost 10); nunca en claro.
 */
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const email = (process.argv[2] || process.env.EMAIL || '').trim().toLowerCase();
const nombre = (process.argv[3] || process.env.NOMBRE || '').trim();
const apellido = (process.argv[4] || process.env.APELLIDO || '').trim();
let password = process.argv[5] || process.env.PASSWORD || '';

if (!email || !nombre || !apellido) {
  console.error(
    'Uso: docker compose exec main-api node scripts/create-superadmin.js <email> "<Nombre>" "<Apellido>" [password]',
  );
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`Email inválido: ${email}`);
  process.exit(1);
}

let generated = false;
if (!password) {
  // Temporal fuerte: 18 chars base64url. El usuario debe rotarla al primer login.
  password = crypto.randomBytes(14).toString('base64url');
  generated = true;
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'telemetry_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function main() {
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    const id = 'U' + crypto.randomBytes(8).toString('hex').slice(0, 9); // VARCHAR(10)

    const res = await client.query(
      `INSERT INTO usuario
         (id, nombre, apellido, email, tipo, password_hash, auth_mode,
          password_set_at, activated_at)
       VALUES ($1, $2, $3, $4, 'SuperAdmin', $5, 'password', NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET
         tipo            = 'SuperAdmin',
         password_hash   = EXCLUDED.password_hash,
         nombre          = EXCLUDED.nombre,
         apellido        = EXCLUDED.apellido,
         password_set_at = NOW(),
         activated_at    = COALESCE(usuario.activated_at, NOW()),
         updated_at      = NOW()
       RETURNING id, email, tipo, (xmax = 0) AS inserted`,
      [id, nombre, apellido, email, hash],
    );
    const row = res.rows[0];
    console.log(
      `✓ ${row.inserted ? 'Creado' : 'Promovido/actualizado'}: ${row.email} (${row.tipo}, id=${row.id})`,
    );
    if (generated) {
      console.log('\n  Contraseña temporal (cópiala ahora, no se vuelve a mostrar):');
      console.log(`  ${password}\n  → el usuario debe cambiarla al primer login.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
