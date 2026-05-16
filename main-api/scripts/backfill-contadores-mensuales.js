#!/usr/bin/env node
/**
 * ============================================================================
 *  BACKFILL DE site_contador_mensual
 * ============================================================================
 *
 *  ¿QUE HACE?
 *  ----------
 *  Recorre las filas crudas del hypertable `equipo` y reconstruye la tabla
 *  agregada `site_contador_mensual` para los ultimos N meses, por cada
 *  variable tipo contador (rol_dashboard ∈ COUNTER_ROLES = totalizador /
 *  energia / volumen) de cada sitio activo.
 *
 *  Para cada (sitio, variable, mes) calcula:
 *      valor_inicio       primera lectura del mes (transformada)
 *      valor_fin          ultima lectura del mes
 *      delta              suma de segmentos positivos (= consumo del mes)
 *      muestras           filas consideradas tras time_bucket('1 minute')
 *      resets_detectados  veces que el contador retrocedio (overflow uint32,
 *                         reemplazo de sensor, etc.) — se segmenta y se
 *                         suman solo los tramos positivos.
 *      ultimo_dato        timestamp de la ultima muestra valida
 *
 *  Idempotente: hace UPSERT con PK (sitio_id, variable_id, mes). Lo puedes
 *  correr cuantas veces quieras; vuelve a sobrescribir cada fila.
 *
 *
 *  ¿CUANDO USARLO?
 *  ---------------
 *  El worker (modules/contadores/worker.ts) ya recomputa solo el mes actual
 *  y el mes anterior cada hora, asi que dia a dia NO necesitas este script.
 *  Se usa para los casos de abajo, cuando el worker no alcanza.
 *
 *
 *  CASOS DE USO
 *  ------------
 *
 *  1. Despliegue inicial / migracion recien aplicada
 *     Tabla recien creada y vacia. El worker llenaria solo el mes actual.
 *     Para tener historial completo:
 *         node scripts/backfill-contadores-mensuales.js --meses=36
 *     Recomendado: correrlo despues de aplicar la migracion
 *     2026-05-15-site-contador-mensual.sql y antes de mostrar el grafico
 *     a los usuarios.
 *
 *  2. Sitio nuevo dado de alta
 *     Acabas de crear el sitio y mapear sus variables. El worker recogera
 *     desde el proximo ciclo (≤ 1h), pero solo recalcula 2 meses. Si el
 *     sitio ya tenia telemetria historica (ej. equipo migrado de otra
 *     plataforma):
 *         node scripts/backfill-contadores-mensuales.js --sitio=S042 --meses=24
 *
 *  3. Mapping de variable corregido (rol o transformacion cambio)
 *     Cambiaste rol_dashboard de 'generico' a 'totalizador', o ajustaste
 *     factor/offset/transformacion en reg_map. La tabla agregada todavia
 *     tiene los deltas viejos:
 *         node scripts/backfill-contadores-mensuales.js --sitio=S010 --meses=12
 *
 *  4. Datos historicos ingestados a `equipo` despues del hecho
 *     Importaste un CSV/dump con telemetria vieja del cliente. El worker
 *     solo refresca los ultimos 2 meses; los meses anteriores quedan con
 *     delta=null hasta que corras:
 *         node scripts/backfill-contadores-mensuales.js --meses=36
 *
 *  5. Inconsistencia o corrupcion detectada en site_contador_mensual
 *     Diagnostica un mes con delta sospechoso, fuerza recomputo y compara:
 *         node scripts/backfill-contadores-mensuales.js --sitio=S007 --meses=3
 *
 *  6. Cambio en la logica de transformacion (refactor de transforms.ts)
 *     Si modificaste applyMappingTransform y los valores numericos
 *     resultantes cambian, la tabla esta obsoleta. Recomputa todo:
 *         node scripts/backfill-contadores-mensuales.js --meses=36
 *
 *  7. Sitio que estuvo inactivo y se reactiva
 *     activo=false → activo=true. Mientras estuvo apagado el worker lo
 *     saltaba. Para llenar los meses que quedaron en blanco:
 *         node scripts/backfill-contadores-mensuales.js --sitio=S015 --meses=12
 *
 *  8. Auditoria DGA / compliance
 *     Auditor pide reporte historico. Asegurate de que los deltas estan
 *     frescos antes de exportar:
 *         node scripts/backfill-contadores-mensuales.js --sitio=S001 --meses=12
 *
 *
 *  PARAMETROS
 *  ----------
 *      --meses=N    Cantidad de meses hacia atras a recomputar (incluye el
 *                   mes actual). Rango [1, 120]. Default 36 (3 años).
 *      --sitio=ID   Limita el backfill a un solo sitio. Si se omite, recorre
 *                   TODOS los sitios activos con variables contador.
 *
 *
 *  EJEMPLOS
 *  --------
 *      # Backfill completo, 3 años, todos los sitios:
 *      node scripts/backfill-contadores-mensuales.js
 *
 *      # Solo 1 año, todos los sitios (mas rapido):
 *      node scripts/backfill-contadores-mensuales.js --meses=12
 *
 *      # Solo el sitio S042, ultimos 6 meses:
 *      node scripts/backfill-contadores-mensuales.js --sitio=S042 --meses=6
 *
 *      # Sitio S010, ultimo año (tras corregir un mapping):
 *      node scripts/backfill-contadores-mensuales.js --sitio=S010 --meses=12
 *
 *
 *  PREREQUISITOS
 *  -------------
 *      1. Migracion aplicada:
 *           psql -f infra-db/migrations/2026-05-15-site-contador-mensual.sql
 *      2. TypeScript compilado a dist/:
 *           npm run build
 *      3. .env del main-api con DB_HOST/DB_USER/DB_PASSWORD/DB_NAME validos.
 *
 *
 *  PERFORMANCE & RIESGOS
 *  ---------------------
 *      - Costo aproximado: ~150ms por (variable, mes) en hypertable con
 *        ~43k filas/mes/sitio (depende del HW). Backfill 36 meses × 70
 *        sitios × ~2 variables contador ≈ 36 × 70 × 2 × 0.15s ≈ 12 min.
 *      - No bloquea ingestion: las queries son READ-ONLY sobre `equipo`.
 *      - Carga IO/CPU significativa: preferible correrlo fuera de horario
 *        peak. Si tu DB es pequeña, considera correrlo de noche.
 *      - El script imprime una linea por (variable, mes) procesada. Util
 *        para detectar variables que fallan (mapping invalido, etc.).
 *
 *
 *  SEGURIDAD
 *  ---------
 *      - No expone endpoints HTTP. Solo se ejecuta desde la maquina con
 *        acceso a la BD.
 *      - No modifica `equipo` ni `reg_map`. Solo upsert en
 *        site_contador_mensual.
 *      - Para correr en produccion: SSH a la maquina del main-api,
 *        `cd /app && node scripts/backfill-contadores-mensuales.js`.
 *
 *
 *  COMO INTERPRETAR LA SALIDA
 *  --------------------------
 *      [backfill] sitio=TODOS meses=36 (2023-06 -> 2026-05)
 *      [backfill] variables contador encontradas: 142
 *      [backfill] S001 Caudalimetro principal (totalizador) -> 36 meses
 *      [backfill] S001 Energia tablero (energia) -> 36 meses
 *      [backfill] S002 Volumen riles (volumen) -> 36 meses
 *      ...
 *      [backfill] OK variables=142 upserts=5112 duracion=712430ms
 *
 *      Si ves "ERROR sitio=Sxxx variable=Vxxx" revisa:
 *        - reg_map.transformacion vs el formato real en equipo.data
 *        - parametros JSONB (factor/offset) bien tipados
 *        - profundidad_pozo_m si la transformacion es nivel_freatico
 *
 * ============================================================================
 */
require('dotenv').config();

const path = require('path');

function parseArgs(argv) {
  const out = { meses: 36, sitio: null };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-z]+)=(.+)$/);
    if (!m) continue;
    if (m[1] === 'meses') out.meses = Math.max(1, Math.min(120, Number(m[2]) || 36));
    if (m[1] === 'sitio') out.sitio = String(m[2]).trim();
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const distBase = path.join(__dirname, '..', 'dist', 'modules', 'contadores');
  const repoMod = require(path.join(distBase, 'repo'));
  const serviceMod = require(path.join(distBase, 'service'));
  const sitesRepoMod = require(path.join(__dirname, '..', 'dist', 'modules', 'sites', 'repo'));

  const { lastNMonths, recomputeMonthsForVariable } = serviceMod;
  const { listCounterVariables, listCounterVariablesForSite, getMappingsBySiteId, getSiteById } =
    repoMod;
  const { getPozoConfigBySiteId } = sitesRepoMod;

  const meses = lastNMonths(args.meses);
  console.log(
    `[backfill] sitio=${args.sitio || 'TODOS'} meses=${args.meses} (${meses[0]
      .toISOString()
      .slice(0, 7)} -> ${meses[meses.length - 1].toISOString().slice(0, 7)})`,
  );

  const counters = args.sitio
    ? await listCounterVariablesForSite(args.sitio)
    : await listCounterVariables();
  console.log(`[backfill] variables contador encontradas: ${counters.length}`);

  const mappingsCache = new Map();
  const pozoCache = new Map();
  let processed = 0;
  let upserts = 0;
  const t0 = Date.now();
  for (const counter of counters) {
    try {
      if (!mappingsCache.has(counter.sitio_id)) {
        mappingsCache.set(counter.sitio_id, await getMappingsBySiteId(counter.sitio_id));
      }
      if (!pozoCache.has(counter.sitio_id)) {
        const site = await getSiteById(counter.sitio_id);
        pozoCache.set(
          counter.sitio_id,
          site && site.tipo_sitio === 'pozo' ? await getPozoConfigBySiteId(counter.sitio_id) : null,
        );
      }
      const mapping = mappingsCache.get(counter.sitio_id).find((m) => m.id === counter.variable_id);
      if (!mapping) continue;
      const pozoConfig = pozoCache.get(counter.sitio_id) ?? null;
      const n = await recomputeMonthsForVariable({ counter, mapping, pozoConfig, meses });
      upserts += n;
      processed++;
      console.log(`[backfill] ${counter.sitio_id} ${counter.alias} (${counter.rol}) -> ${n} meses`);
    } catch (err) {
      console.error(
        `[backfill] ERROR sitio=${counter.sitio_id} variable=${counter.variable_id}:`,
        err.message,
      );
    }
  }
  console.log(
    `[backfill] OK variables=${processed} upserts=${upserts} duracion=${Date.now() - t0}ms`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] FATAL', err);
    process.exit(1);
  });
