#!/usr/bin/env node
/**
 * ============================================================================
 *  RESET DE SLOTS DGA PENDIENTES → VACIO (para recomputar con transform actual)
 * ============================================================================
 *
 *  ¿QUE HACE?
 *  ----------
 *  Los slots `dato_dga` en estatus 'pendiente' guardan el valor
 *  (caudal/nivel/totalizador) CONGELADO al momento en que el worker fill los
 *  creó. Si despues cambiaste el mapping/transform de una variable en reg_map
 *  (ej. agregaste un offset a un IEEE754), esos pendientes NO se recomputan
 *  solos: el worker fill solo procesa slots 'vacio'.
 *
 *  Este script resetea los pendientes de UN sitio, desde un instante dado,
 *  de vuelta a 'vacio' (y limpia los valores congelados). El worker fill
 *  (modules/dga/worker.ts, corre cada ~60s) los volvera a rellenar leyendo el
 *  crudo de `equipo` y aplicando el transform ACTUAL (con el offset), dejando
 *  el valor corregido antes de que el submission worker los mande a SNIA.
 *
 *  NO toca el dato crudo (es correcto). NO recalcula valores a mano (reusa la
 *  logica desplegada de applyMappingTransform via el worker). NO toca slots ya
 *  'enviado' (esos ya fueron a SNIA — requieren rectificacion con SNIA, otro
 *  proceso) ni 'enviando' (en vuelo).
 *
 *
 *  USO
 *  ---
 *      # 1) DRY-RUN (default): solo LISTA que haria, sin cambiar nada
 *      node scripts/reset-dga-pendientes-recompute.js --sitio=S106
 *
 *      # 2) Ventana explicita (UTC). Default: hoy 13:00Z = 09:00 hora Chile (UTC-4)
 *      node scripts/reset-dga-pendientes-recompute.js --sitio=S106 --desde-utc=2026-08-10T13:00:00Z
 *
 *      # 3) APLICAR el reset (tras revisar el dry-run)
 *      node scripts/reset-dga-pendientes-recompute.js --sitio=S106 --apply
 *
 *  ARGS
 *      --sitio=ID        Requerido. sitio.id o id_serial del sitio (S106).
 *      --desde-utc=ISO   Instante UTC desde el cual resetear (inclusive).
 *                        Default: hoy a las 13:00:00Z (= 09:00 Chile, UTC-4).
 *      --hasta-utc=ISO   Instante UTC tope (exclusivo). Default: sin tope.
 *      --apply           Ejecuta el UPDATE. Sin este flag es solo lectura.
 *
 *  NOTA HORARIA: el pipeline DGA interpreta la hora local con offset FIJO
 *  UTC-4 (submission.ts tsToChileLocal). Por eso "09:00 Chile" = "13:00Z".
 * ============================================================================
 */
require('dotenv').config();

const path = require('path');
const { query, pool } = require(path.join(__dirname, '..', 'dist', 'config', 'dbHelpers'));

function parseArgs(argv) {
  const out = { sitio: null, desdeUtc: null, hastaUtc: null, apply: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--apply') {
      out.apply = true;
      continue;
    }
    const m = arg.match(/^--([a-z-]+)=(.+)$/);
    if (!m) continue;
    if (m[1] === 'sitio') out.sitio = String(m[2]).trim();
    if (m[1] === 'desde-utc') out.desdeUtc = String(m[2]).trim();
    if (m[1] === 'hasta-utc') out.hastaUtc = String(m[2]).trim();
  }
  return out;
}

/** Hoy a las 13:00:00Z (= 09:00 hora Chile con offset fijo UTC-4). */
function defaultDesdeUtc() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 13, 0, 0));
  return d.toISOString();
}

async function resolveSite(idOrSerial) {
  const r = await query(
    `SELECT id, id_serial, descripcion, activo
       FROM sitio
      WHERE id = $1 OR id_serial = $1`,
    [idOrSerial],
  );
  return r.rows;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.sitio) {
    console.error('ERROR: falta --sitio=ID (sitio.id o id_serial). Ej: --sitio=S106');
    process.exit(2);
  }

  const desdeUtc = args.desdeUtc || defaultDesdeUtc();
  const hastaUtc = args.hastaUtc || null;

  console.log('════════════════════════════════════════════════════════════');
  console.log(`[reset-dga] sitio=${args.sitio}  modo=${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`[reset-dga] ventana: ts >= ${desdeUtc}${hastaUtc ? `  AND ts < ${hastaUtc}` : ''}`);
  console.log('════════════════════════════════════════════════════════════');

  // 1) Resolver sitio
  const sites = await resolveSite(args.sitio);
  if (sites.length === 0) {
    console.error(`ERROR: no se encontro sitio con id o id_serial = "${args.sitio}"`);
    process.exit(3);
  }
  if (sites.length > 1) {
    console.error(`ERROR: "${args.sitio}" matchea ${sites.length} sitios (ambiguo):`);
    for (const s of sites)
      console.error(`   id=${s.id} id_serial=${s.id_serial} "${s.descripcion}"`);
    process.exit(3);
  }
  const site = sites[0];
  console.log(
    `[reset-dga] sitio resuelto: id=${site.id} id_serial=${site.id_serial} "${site.descripcion}" activo=${site.activo}`,
  );

  // 2) Panorama por estatus en la ventana
  const rangeParams = hastaUtc ? [site.id, desdeUtc, hastaUtc] : [site.id, desdeUtc];
  const rangeCond = hastaUtc ? 'ts >= $2 AND ts < $3' : 'ts >= $2';

  const breakdown = await query(
    `SELECT estatus, COUNT(*)::int AS n, MIN(ts) AS min_ts, MAX(ts) AS max_ts
       FROM dato_dga
      WHERE site_id = $1 AND ${rangeCond}
      GROUP BY estatus
      ORDER BY estatus`,
    rangeParams,
  );

  console.log('\n[reset-dga] slots en la ventana por estatus:');
  if (breakdown.rows.length === 0) {
    console.log('   (ninguno)');
  }
  for (const row of breakdown.rows) {
    const flag =
      row.estatus === 'pendiente'
        ? '  <-- se reseteara a vacio'
        : row.estatus === 'enviado' || row.estatus === 'enviando'
          ? '  (SE OMITE — no se toca)'
          : '';
    console.log(
      `   ${String(row.estatus).padEnd(16)} n=${row.n}  [${row.min_ts?.toISOString?.() ?? row.min_ts} .. ${row.max_ts?.toISOString?.() ?? row.max_ts}]${flag}`,
    );
  }

  // 3) Detalle de los pendientes que se resetearian (valor viejo congelado)
  const pend = await query(
    `SELECT ts, caudal_instantaneo, flujo_acumulado, nivel_freatico
       FROM dato_dga
      WHERE site_id = $1 AND ${rangeCond} AND estatus = 'pendiente'
      ORDER BY ts ASC`,
    rangeParams,
  );

  console.log(`\n[reset-dga] pendientes a resetear: ${pend.rows.length}`);
  for (const row of pend.rows.slice(0, 50)) {
    console.log(
      `   ${row.ts?.toISOString?.() ?? row.ts}  caudal=${row.caudal_instantaneo}  nivel=${row.nivel_freatico}  totalizador=${row.flujo_acumulado}`,
    );
  }
  if (pend.rows.length > 50) console.log(`   ... (+${pend.rows.length - 50} mas)`);

  if (pend.rows.length === 0) {
    console.log('\n[reset-dga] nada que resetear. Fin.');
    return;
  }

  // 4) Aplicar (solo con --apply)
  if (!args.apply) {
    console.log('\n[reset-dga] DRY-RUN — no se cambio nada. Reejecuta con --apply para aplicar.');
    console.log('[reset-dga] UPDATE que se ejecutaria:');
    console.log(
      `   UPDATE dato_dga SET estatus='vacio', caudal_instantaneo=NULL, flujo_acumulado=NULL, nivel_freatico=NULL, fail_reason=NULL\n` +
        `    WHERE site_id='${site.id}' AND ${rangeCond.replace('$2', `'${desdeUtc}'`).replace('$3', hastaUtc ? `'${hastaUtc}'` : '')} AND estatus='pendiente';`,
    );
    return;
  }

  const upd = await query(
    `UPDATE dato_dga
        SET estatus = 'vacio',
            caudal_instantaneo = NULL,
            flujo_acumulado    = NULL,
            nivel_freatico     = NULL,
            fail_reason        = NULL
      WHERE site_id = $1 AND ${rangeCond} AND estatus = 'pendiente'`,
    rangeParams,
  );

  console.log(`\n[reset-dga] APPLY OK — slots reseteados a 'vacio': ${upd.rowCount}`);
  console.log(
    '[reset-dga] El worker fill los recomputara (~<=60s) con el transform actual y volveran a pendiente.',
  );
}

main()
  .then(async () => {
    if (pool && typeof pool.end === 'function') await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[reset-dga] FATAL', err);
    if (pool && typeof pool.end === 'function') await pool.end();
    process.exit(1);
  });
