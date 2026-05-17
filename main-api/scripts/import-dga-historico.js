#!/usr/bin/env node
/**
 * ============================================================================
 *  IMPORTADOR HISTÓRICO DGA (CSV legacy → dato_dga + dga_send_audit)
 * ============================================================================
 *
 *  ¿QUE HACE?
 *  ----------
 *  Lee un CSV exportado del sistema legacy con mediciones DGA ya enviadas
 *  a SNIA y las carga en el schema nuevo:
 *    - dato_dga         (estatus='enviado', valores históricos, comprobante)
 *    - dga_send_audit   (transport='legacy-import', dga_status_code='00',
 *                        api_n_comprobante, sent_at del CSV)
 *
 *  Permite migrar el histórico antes de flipear `transport='rest'` en el
 *  nuevo dga-api: el shadow worker puede comparar valores nuevos vs los
 *  importados para validar paridad antes de cortar legacy.
 *
 *
 *  FORMATO CSV ESPERADO
 *  --------------------
 *  Header obligatorio (en este orden o cualquier orden, se mapea por nombre):
 *
 *      codigo_obra,measurement_date,measurement_time,flow,level,totalizator,sent_at,api_n_comprobante
 *
 *  Ejemplo:
 *      OB-0601-292,2024-03-25 03:00:00,12:00:00,0,1,103930,2024-04-26 17:35:11,2ebeb58fc029fe1c12ba8c7fb44de50b
 *
 *  Notas:
 *    - measurement_date trae hora 03:00:00 espuria (cast Postgres timestamp).
 *      Tomamos solo la parte DATE. La hora real está en measurement_time.
 *    - totalizator puede venir con decimales (548669.188). Se trunca a entero
 *      para guardar en flujo_acumulado (consistencia web/SNIA, Res 2170 §4).
 *      El valor decimal original se preserva en totalizator_raw_legacy.
 *    - sent_at es el momento del envío legacy a SNIA (no la fecha actual).
 *    - api_n_comprobante es el folio devuelto por SNIA. Puede repetirse en
 *      filas consecutivas (envío en lote legacy).
 *
 *
 *  IDEMPOTENCIA
 *  ------------
 *  Reejecutar el script no duplica. dato_dga usa ON CONFLICT (id_dgauser, ts)
 *  DO UPDATE, sobrescribiendo el slot con los datos del CSV. dga_send_audit
 *  es append-only — múltiples corridas SÍ generan filas duplicadas en audit
 *  (1 por corrida). Si te preocupa, agrega filtro --skip-audit-if-exists
 *  (no implementado).
 *
 *
 *  USO
 *  ---
 *      node scripts/import-dga-historico.js --csv=<path>
 *      node scripts/import-dga-historico.js --csv=ruta.csv --user=42
 *
 *  Si una obra tiene varios informantes (dga_user), el script aborta y pide
 *  --user=<id_dgauser> para elegir cuál usar.
 *
 *  Flags:
 *    --csv=<path>     Ruta al archivo CSV (obligatorio).
 *    --user=<n>       ID del dga_user a usar (override cuando hay varios
 *                     informantes por obra).
 *    --dry-run        Parsea y valida pero NO escribe a DB.
 *    --batch=<n>      Filas por log de progreso (default 500).
 *
 *
 *  PREREQUISITOS
 *  -------------
 *      1. Migración aplicada:
 *           psql -f infra-db/migrations/2026-05-16-dga-pipeline-refactor.sql
 *      2. TypeScript compilado:
 *           npm run build
 *      3. dga_user del informante registrado en BD con su site_id apuntando
 *         al pozo_config.obra_dga correspondiente.
 *      4. .env del main-api con DB_HOST/DB_USER/DB_PASSWORD/DB_NAME válidos.
 *
 *
 *  SEGURIDAD
 *  ---------
 *      - Solo escribe en dato_dga y dga_send_audit. NO toca credenciales
 *        ni envía nada a SNIA.
 *      - Datos quedan como 'enviado' inmediatamente (no van por la cola de
 *        submission). Esto es correcto: el legacy ya los envió.
 *
 *
 *  EJEMPLO DE SALIDA
 *  -----------------
 *      [import] csv=historico_dga_OB-0601-292.csv
 *      [import] header OK: 8 columnas
 *      [import] dga_user resuelto: id=12 site=S001 rut=11111111-1
 *      [import] obra (denormalizada): Pozo Principal
 *      [import] procesando filas...
 *      [import] 500 filas... (último ts: 2024-04-15T12:00:00Z)
 *      [import] 1000 filas... (último ts: 2024-05-06T00:00:00Z)
 *      ...
 *      [import] OK total=18589 dato_dga_upsert=18589 audit_insert=18589 duracion=42130ms
 *
 * ============================================================================
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(argv) {
  const out = { csv: null, user: null, dryRun: false, batch: 500 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    const m = arg.match(/^--([a-z-]+)=(.+)$/);
    if (!m) continue;
    if (m[1] === 'csv') out.csv = m[2];
    if (m[1] === 'user') out.user = Number(m[2]);
    if (m[1] === 'batch') out.batch = Math.max(50, Math.min(10000, Number(m[2]) || 500));
  }
  return out;
}

/**
 * Parser CSV minimalista (sin quoted commas). Suficiente para el formato
 * de export legacy. Si en el futuro el CSV tiene campos con comas escapadas
 * o saltos de línea, migrar a papaparse/csv-parse.
 */
function parseCsvLine(line) {
  return line.split(',').map((s) => s.trim());
}

/**
 * Convierte (date 'YYYY-MM-DD HH:MM:SS' o 'YYYY-MM-DD', time 'HH:MM:SS')
 * en TIMESTAMPTZ ISO interpretando la hora como local Chile (UTC-4).
 * Tomamos solo la parte DATE del primer campo (la hora del field date es
 * artefacto del cast Postgres timestamp en el export).
 */
function combineDateTimeChile(dateField, timeField) {
  const datePart = String(dateField).split(' ')[0]; // 'YYYY-MM-DD'
  // Construir ISO con offset Chile: 'YYYY-MM-DDTHH:MM:SS-04:00' → Date parsea como UTC instant correcto.
  const iso = `${datePart}T${timeField}-04:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`fecha/hora inválida: date=${dateField} time=${timeField}`);
  }
  return d.toISOString();
}

function numericOrNull(s) {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.csv) {
    console.error('ERROR: --csv=<path> es obligatorio');
    process.exit(2);
  }
  if (!fs.existsSync(args.csv)) {
    console.error(`ERROR: CSV no encontrado: ${args.csv}`);
    process.exit(2);
  }

  console.log(`[import] csv=${args.csv}${args.dryRun ? ' DRY-RUN' : ''}`);

  // Cargar módulos compilados (mismo patrón que backfill-contadores).
  const distBase = path.join(__dirname, '..', 'dist', 'modules', 'dga');
  let dgaRepo;
  let siteRepo;
  try {
    dgaRepo = require(path.join(distBase, 'repo'));
    siteRepo = require(path.join(__dirname, '..', 'dist', 'modules', 'sites', 'repo'));
  } catch (err) {
    console.error('ERROR cargando dist/. ¿Ejecutaste npm run build?', err.message);
    process.exit(2);
  }

  // Stream del CSV.
  const stream = fs.createReadStream(args.csv, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header = null;
  let cols = {};
  let total = 0;
  let upserts = 0;
  let audits = 0;
  let skipped = 0;
  let userResolved = null; // { id_dgauser, site_id, obra }
  const startedAt = Date.now();

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^﻿/, '').trim(); // strip BOM si viene
    if (!line) continue;
    if (!header) {
      header = parseCsvLine(line);
      cols = Object.fromEntries(header.map((h, i) => [h, i]));
      const required = [
        'codigo_obra',
        'measurement_date',
        'measurement_time',
        'flow',
        'level',
        'totalizator',
        'sent_at',
        'api_n_comprobante',
      ];
      const missing = required.filter((c) => !(c in cols));
      if (missing.length > 0) {
        console.error(`ERROR: header CSV inválido. Faltan: ${missing.join(', ')}`);
        process.exit(2);
      }
      console.log(`[import] header OK: ${header.length} columnas`);
      continue;
    }

    const parts = parseCsvLine(line);
    const codigoObra = parts[cols.codigo_obra];

    // Resolver sitio por codigo_obra (lookup pozo_config.obra_dga). Asumimos
    // CSV = una obra → un sitio.
    if (!userResolved) {
      const siteId = await dgaRepo.findSiteByCodigoObra(codigoObra);
      if (!siteId) {
        console.error(
          `ERROR: ningún sitio encontrado con pozo_config.obra_dga=${codigoObra}. ` +
            `Verifica que el pozo exista y tenga el código de obra cargado.`,
        );
        process.exit(2);
      }
      const site = await siteRepo.getSiteById(siteId);
      const pozoConfig = await siteRepo.getPozoConfigBySiteId(siteId);
      const obra = (pozoConfig && pozoConfig.obra_dga ? pozoConfig.obra_dga.trim() : '') ||
                   (site ? site.descripcion : codigoObra);
      userResolved = { site_id: siteId, obra };
      console.log(`[import] sitio resuelto: id=${siteId}`);
      console.log(`[import] obra (denormalizada): ${userResolved.obra}`);
      console.log('[import] procesando filas...');
    }

    // Filtro defensivo: si por error el CSV mezcla obras, saltamos lo que
    // no coincida con la obra del primer match.
    if (codigoObra !== parts[cols.codigo_obra]) {
      skipped++;
      continue;
    }

    let ts;
    try {
      ts = combineDateTimeChile(parts[cols.measurement_date], parts[cols.measurement_time]);
    } catch (err) {
      console.warn(`[import] fila inválida (saltada): ${err.message}`);
      skipped++;
      continue;
    }

    const totalizatorRaw = numericOrNull(parts[cols.totalizator]);
    const totalizatorTrunc = totalizatorRaw == null ? null : Math.trunc(totalizatorRaw);
    const caudal = numericOrNull(parts[cols.flow]);
    const nivel = numericOrNull(parts[cols.level]);
    const comprobante = parts[cols.api_n_comprobante] || null;
    const sentAt = parts[cols.sent_at] || null;

    if (!args.dryRun) {
      try {
        await dgaRepo.upsertDatoDgaFromLegacy({
          site_id: userResolved.site_id,
          ts,
          obra: userResolved.obra,
          caudal_instantaneo: caudal,
          flujo_acumulado_truncado: totalizatorTrunc,
          totalizator_raw_legacy: totalizatorRaw,
          nivel_freatico: nivel,
          comprobante,
        });
        upserts++;

        // Audit append-only por cada fila importada. Marcamos transport
        // como 'legacy-import' para distinguir de envíos reales nuevos.
        await dgaRepo.insertSendAudit({
          site_id: userResolved.site_id,
          ts,
          attempt_n: 1,
          transport: 'legacy-import',
          http_status: 200,
          dga_status_code: '00',
          dga_message: null,
          api_n_comprobante: comprobante,
          api_status_description: null,
          request_payload: null,
          raw_response: null,
          duration_ms: 0,
          sent_at: sentAt, // override con el real del CSV
        });
        audits++;
      } catch (err) {
        console.error(`[import] fallo en ts=${ts}: ${err.message}`);
      }
    }

    total++;
    if (total % args.batch === 0) {
      console.log(`[import] ${total} filas... (último ts: ${ts})`);
    }
  }

  const duracion = Date.now() - startedAt;
  console.log(
    `[import] OK total=${total} dato_dga_upsert=${upserts} audit_insert=${audits} ` +
      `skipped=${skipped} duracion=${duracion}ms${args.dryRun ? ' DRY-RUN' : ''}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[import] ERROR fatal:', err.stack || err.message);
    process.exit(1);
  });
