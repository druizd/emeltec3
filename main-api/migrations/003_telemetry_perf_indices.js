/**
 * Índices y optimizaciones para queries calientes de telemetría sobre la tabla `equipo`.
 *
 * Crear índice (id_serial, time DESC) para acelerar:
 *  - findLatestSerialId
 *  - findLatestReferenceTimestamp
 *  - findHistory ordenado por time DESC
 *  - findOnlineValues (DISTINCT ON sobre kv.key, time DESC)
 *
 * Idempotente — CREATE INDEX IF NOT EXISTS.
 */
const db = require('../src/config/db');

async function migrate() {
  const steps = [
    {
      name: 'idx_equipo_serial_time_desc',
      sql: `CREATE INDEX IF NOT EXISTS idx_equipo_serial_time_desc
            ON equipo (id_serial, time DESC)`,
    },
    {
      name: 'idx_equipo_data_gin',
      sql: `CREATE INDEX IF NOT EXISTS idx_equipo_data_gin
            ON equipo USING GIN (data jsonb_path_ops)`,
    },
    {
      name: 'idx_api_metrics_lookup',
      sql: `CREATE INDEX IF NOT EXISTS idx_api_metrics_lookup
            ON api_metrics (endpoint, domain_slug, serial_id)`,
    },
    {
      name: 'idx_api_variable_metrics_lookup',
      sql: `CREATE INDEX IF NOT EXISTS idx_api_variable_metrics_lookup
            ON api_variable_metrics (nombre_dato, serial_id)`,
    },
  ];

  try {
    console.log('[migration 003] Iniciando creación de índices…');
    for (const step of steps) {
      console.log(`[migration 003] ${step.name}…`);
      await db.query(step.sql);
    }
    console.log('[migration 003] Listo.');
    process.exit(0);
  } catch (err) {
    console.error('[migration 003] Error:', err.message);
    process.exit(1);
  }
}

migrate();
