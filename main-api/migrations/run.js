/**
 * Runner de migraciones — se ejecuta al arrancar el contenedor, antes del server.
 *
 * Diseño:
 *  - Tabla de control `schema_migrations`: cada archivo aplicado se registra y
 *    no se vuelve a ejecutar (las migraciones existentes son idempotentes vía
 *    IF NOT EXISTS, pero el registro permite migraciones futuras que no lo sean).
 *  - Advisory lock de Postgres: si dos réplicas arrancan a la vez, solo una migra.
 *  - Cada migración corre como proceso hijo (`node <archivo>`) porque los
 *    scripts existentes terminan con process.exit() y matarían este runner
 *    si se importaran con require().
 *  - Cualquier fallo aborta con exit 1 → el contenedor NO arranca el server
 *    con un schema a medias (docker restart policy reintenta).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../src/config/db');

// Clave arbitraria fija para el advisory lock de migraciones de esta app.
const LOCK_KEY = 7215021;

async function main() {
  const files = fs
    .readdirSync(__dirname)
    .filter((f) => /^\d{3}_.*\.js$/.test(f))
    .sort();

  await db.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre     TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Baseline: las migraciones 001–006 corrieron históricamente a mano
    // (el schema base nunca se creó por migración). En una instalación
    // existente (tabla usuario presente) con schema_migrations vacía, se
    // registran como aplicadas SIN re-ejecutarlas — re-correrlas contra
    // datos reales no aporta y algunas asumen tablas creadas manualmente
    // (p.ej. 003 indexa api_metrics).
    const BASELINE = [
      '001_add_sub_empresa_id.js',
      '002_add_user_corporate_fields.js',
      '003_telemetry_perf_indices.js',
      '004_audit_log_and_lockout.js',
      '005_account_auth_preferences.js',
      '006_cold_room_haccp.js',
    ];
    const vacia = (await db.query('SELECT 1 FROM schema_migrations LIMIT 1')).rows.length === 0;
    const instalacionExistente =
      (await db.query("SELECT to_regclass('public.usuario') AS t")).rows[0]?.t !== null;
    if (vacia && instalacionExistente) {
      for (const nombre of BASELINE) {
        await db.query(
          'INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING',
          [nombre],
        );
      }
      console.log(`[migrations] Baseline registrado (${BASELINE.length} históricas).`);
    }

    const { rows } = await db.query('SELECT nombre FROM schema_migrations');
    const aplicadas = new Set(rows.map((r) => r.nombre));

    let ejecutadas = 0;
    for (const file of files) {
      if (aplicadas.has(file)) continue;
      console.log(`[migrations] Ejecutando ${file}...`);
      // stdio inherit: la salida de la migración va al log del contenedor.
      execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
      await db.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [file]);
      ejecutadas += 1;
    }
    console.log(
      `[migrations] Listo: ${ejecutadas} ejecutada(s), ${files.length - ejecutadas} ya aplicada(s).`,
    );
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrations] Error — el server NO va a arrancar:', err);
    process.exit(1);
  });
