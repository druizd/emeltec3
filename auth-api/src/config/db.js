const { Pool } = require('pg');
const { db }   = require('./env');

const pool = new Pool({
  host:                    db.host,
  port:                    db.port,
  database:                db.database,
  user:                    db.user,
  password:                db.password,
  max:                     db.max,
  idleTimeoutMillis:       db.idleTimeoutMillis,
  connectionTimeoutMillis: db.connectionTimeoutMillis,
});

pool.on('error', (err) => {
  console.error('[auth-api][DB] Error inesperado en el pool:', err.message);
});

pool.query('SELECT NOW()')
  .then(() => console.log('[auth-api][DB] Conexión a TimescaleDB exitosa'))
  .catch((err) => console.error('[auth-api][DB] No se pudo conectar:', err.message));

module.exports = pool;
