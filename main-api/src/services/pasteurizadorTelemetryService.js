const db = require('../config/db');
const { CHILE_TIME_ZONE } = require('../utils/timezone');
const { buildSiteDashboardData } = require('./siteTelemetryService');

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, coord_norte, coord_este, huso, tipo_sitio, activo, es_maleta_piloto';
const MAP_COLUMNS =
  'id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id, created_at, updated_at';

const PASTEURIZADOR_SITE_TYPE = 'pasteurizador';

const PASTEURIZADOR_ROLE_DEFS = Object.freeze([
  {
    id: 'temperatura_pasteurizacion',
    label: 'Temperatura pasteurizacion',
    unit: 'C',
    kind: 'temperature',
  },
  { id: 'temperatura_entrada', label: 'Temperatura entrada', unit: 'C', kind: 'temperature' },
  { id: 'salida_producto_tina', label: 'Salida producto a tina', unit: 'L', kind: 'counter' },
  { id: 'estado_valvula', label: 'Estado valvula', unit: '0/1', kind: 'state' },
  { id: 'cierres_valvula', label: 'Cierres valvula', unit: 'N', kind: 'counter' },
  { id: 'errores_criticos', label: 'Errores criticos', unit: 'N', kind: 'counter' },
  { id: 'tiempo_batch', label: 'Tiempo batch', unit: 'min', kind: 'duration' },
  {
    id: 'temperatura_promedio_batch',
    label: 'Temperatura promedio batch',
    unit: 'C',
    kind: 'temperature',
  },
  {
    id: 'temperatura_ingreso_agua',
    label: 'Temperatura ingreso agua',
    unit: 'C',
    kind: 'temperature',
  },
  { id: 'presion_vapor', label: 'Presion vapor', unit: 'bar', kind: 'pressure' },
  {
    id: 'temperatura_gases_combustion',
    label: 'Temperatura gases combustion',
    unit: 'C',
    kind: 'temperature',
  },
  { id: 'señal', label: 'Senal', unit: '%', kind: 'signal' },
]);

const PASTEURIZADOR_ROLE_IDS = Object.freeze(PASTEURIZADOR_ROLE_DEFS.map((role) => role.id));
const PASTEURIZADOR_ROLE_BY_ID = new Map(PASTEURIZADOR_ROLE_DEFS.map((role) => [role.id, role]));
const PASTEURIZADOR_DEFAULT_HISTORY_ROLES = Object.freeze([
  'temperatura_pasteurizacion',
  'temperatura_entrada',
  'salida_producto_tina',
  'estado_valvula',
  'errores_criticos',
  'presion_vapor',
]);
const PASTEURIZADOR_DAILY_KPI_ROLES = Object.freeze([
  'temperatura_pasteurizacion',
  'salida_producto_tina',
  'cierres_valvula',
  'errores_criticos',
]);

const PASTEURIZADOR_HISTORY_GRANULARITY = Object.freeze({
  '1m': { view: 'equipo_1min', bucketInterval: '1 minute', label: '1 minuto', maxDays: 93 },
  '5m': { view: 'equipo_5min', bucketInterval: '5 minutes', label: '5 minutos', maxDays: 93 },
  '1h': { view: 'equipo_hourly', bucketInterval: '1 hour', label: '1 hora', maxDays: 366 },
  '1d': { view: 'equipo_daily', bucketInterval: '1 day', label: '1 dia', maxDays: 1095 },
});

const PASTEURIZADOR_BUNDLE_INPUTS_TTL_MS = 30_000;
const PASTEURIZADOR_BATCH_MIN_L = 7000;
const PASTEURIZADOR_BATCH_MAX_L = 9000;
const PASTEURIZADOR_PRODUCT_RESET_DROP_L = 500;
const PASTEURIZADOR_PRODUCT_ACTIVE_EPSILON_L = 1;
const PASTEURIZADOR_PRODUCT_RESET_CONFIRM_POINTS = 2;
const PASTEURIZADOR_OPERATION_TEMP_MIN_C = 50;
const pasteurizadorBundleInputsCache = new Map();
const pasteurizadorBundleInputsInflight = new Map();

function pasteurizadorBundleInputsCacheKey(siteId) {
  return String(siteId || '').trim();
}

function getCachedPasteurizadorBundleInputs(siteId) {
  const key = pasteurizadorBundleInputsCacheKey(siteId);
  const cached = pasteurizadorBundleInputsCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    pasteurizadorBundleInputsCache.delete(key);
    return null;
  }
  return cached.inputs;
}

function setCachedPasteurizadorBundleInputs(siteId, inputs) {
  pasteurizadorBundleInputsCache.set(pasteurizadorBundleInputsCacheKey(siteId), {
    inputs,
    expiresAt: Date.now() + PASTEURIZADOR_BUNDLE_INPUTS_TTL_MS,
  });
}

function invalidatePasteurizadorBundleInputsCache(siteId) {
  pasteurizadorBundleInputsCache.delete(pasteurizadorBundleInputsCacheKey(siteId));
}

function cleanString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toUtcIsoString(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeToken(value) {
  return cleanString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function canonicalPasteurizadorRole(value) {
  const token = normalizeToken(value);
  if (!token) return null;
  return PASTEURIZADOR_ROLE_DEFS.find((role) => normalizeToken(role.id) === token)?.id || null;
}

function normalizePasteurizadorRoles(value, fallback = PASTEURIZADOR_DEFAULT_HISTORY_ROLES) {
  if (value === undefined || value === null || cleanString(value) === '') {
    return { ok: true, roles: [...fallback] };
  }

  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const roles = [];
  const invalid = [];

  for (const part of raw.split(',')) {
    const role = canonicalPasteurizadorRole(part);
    if (!role) {
      const cleaned = cleanString(part);
      if (cleaned) invalid.push(cleaned);
      continue;
    }
    if (!roles.includes(role)) roles.push(role);
  }

  if (invalid.length) {
    return {
      ok: false,
      roles: [],
      error: `roles no validos para pasteurizador: ${invalid.join(', ')}`,
    };
  }

  if (!roles.length) {
    return { ok: false, roles: [], error: 'Debe indicar al menos un role valido.' };
  }

  return { ok: true, roles };
}

function serializeSite(site) {
  return {
    id: site.id,
    descripcion: site.descripcion,
    id_serial: site.id_serial,
    tipo_sitio: site.tipo_sitio,
    activo: site.activo,
  };
}

function findVariableForRole(variables, roleId) {
  return (
    variables.find(
      (variable) =>
        canonicalPasteurizadorRole(variable.rol_dashboard) === roleId ||
        canonicalPasteurizadorRole(variable.key) === roleId,
    ) || null
  );
}

function serializeVariable(roleId, variable) {
  const def = PASTEURIZADOR_ROLE_BY_ID.get(roleId);
  const missing = !variable;
  const ok = !missing && variable.ok !== false;

  return {
    role: roleId,
    label: def?.label || roleId,
    kind: def?.kind || 'generic',
    ok,
    valor: ok ? (variable.valor ?? null) : null,
    unidad: variable?.unidad || def?.unit || null,
    alias: variable?.alias || null,
    error: missing ? 'Variable no mapeada.' : variable.error || null,
  };
}

function buildPasteurizadorVariableMap(variables, roles = PASTEURIZADOR_ROLE_IDS) {
  const out = {};
  for (const roleId of roles) {
    out[roleId] = serializeVariable(roleId, findVariableForRole(variables, roleId));
  }
  return out;
}

function readRoleNumber(roleMap, roleId) {
  const variable = roleMap?.[roleId];
  if (!variable?.ok) return null;
  return numberOrNull(variable.valor);
}

function readBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = cleanString(value).toLowerCase();
  return ['1', 'true', 'on', 'abierta', 'abierto', 'open'].includes(normalized);
}

function deriveOperationalStatus(roleMap, latest) {
  if (!latest) {
    return {
      id: 'sin_datos',
      label: 'Sin datos',
      severity: 'warning',
      valve_open: null,
    };
  }

  const criticalErrors = readRoleNumber(roleMap, 'errores_criticos');
  const valve = roleMap.estado_valvula;
  const valveOpen = valve?.ok ? readBooleanLike(valve.valor) : null;

  if (criticalErrors !== null && criticalErrors > 0) {
    return {
      id: 'critico',
      label: 'Error critico',
      severity: 'critical',
      valve_open: valveOpen,
    };
  }

  return {
    id: 'operativo',
    label: 'Operativo',
    severity: 'normal',
    valve_open: valveOpen,
  };
}

function buildDashboardForRaw(site, mappings, rawRow) {
  return buildSiteDashboardData({
    site,
    pozoConfig: null,
    mappings,
    latest: rawRow
      ? {
          time: rawRow.time,
          received_at: rawRow.received_at,
          id_serial: rawRow.id_serial || site.id_serial,
          data: rawRow.data || {},
        }
      : null,
  });
}

function buildHistoryRow({ site, mappings, rawRow, roles }) {
  const dashboard = buildDashboardForRaw(site, mappings, rawRow);
  return {
    timestamp: toUtcIsoString(rawRow.time),
    received_at: toUtcIsoString(rawRow.received_at),
    variables: buildPasteurizadorVariableMap(dashboard.variables || [], roles),
  };
}

function seedSummaryStats(roles) {
  const out = {};
  for (const roleId of roles) {
    const def = PASTEURIZADOR_ROLE_BY_ID.get(roleId);
    out[roleId] = {
      role: roleId,
      label: def?.label || roleId,
      kind: def?.kind || 'generic',
      unidad: def?.unit || null,
      n: 0,
      numeric_n: 0,
      min: null,
      max: null,
      avg: null,
      latest: null,
      latest_at: null,
      alias: null,
      ok: false,
    };
  }
  return out;
}

function updateSummaryStats(stats, roleId, metric, timestamp) {
  if (!metric?.ok) return;
  const entry = stats[roleId];
  if (!entry) return;

  entry.ok = true;
  entry.n++;
  entry.latest = metric.valor ?? null;
  entry.latest_at = timestamp;
  entry.unidad = metric.unidad || entry.unidad;
  entry.alias = metric.alias || entry.alias;

  const numeric = numberOrNull(metric.valor);
  if (numeric === null) return;

  entry.numeric_n++;
  entry.min = entry.min === null ? numeric : Math.min(entry.min, numeric);
  entry.max = entry.max === null ? numeric : Math.max(entry.max, numeric);
  entry._sum = (entry._sum || 0) + numeric;
  entry.avg = entry._sum / entry.numeric_n;
}

function finalizeSummaryStats(stats) {
  for (const entry of Object.values(stats)) {
    delete entry._sum;
  }
  return stats;
}

function roundNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}

function readHistoryMetricNumber(row, roleId) {
  const metric = row?.variables?.[roleId];
  if (!metric?.ok) return null;
  return numberOrNull(metric.valor);
}

function createPasteurizadorCycle(point) {
  return {
    start_at: point.timestamp,
    end_at: point.timestamp,
    start_ms: point.timestampMs,
    end_ms: point.timestampMs,
    max_product_l: point.producto,
    last_product_l: point.producto,
    temp_sum: point.temp === null ? 0 : point.temp,
    temp_count: point.temp === null ? 0 : 1,
    point_count: 1,
    cierres_values: point.cierres === null ? [] : [point.cierres],
    errores_values: point.errores === null ? [] : [point.errores],
    reset_zero_count: 0,
    reset_at: null,
    reset_ms: null,
  };
}

function updatePasteurizadorCycle(cycle, point) {
  cycle.end_at = point.timestamp;
  cycle.end_ms = point.timestampMs;
  cycle.max_product_l = Math.max(cycle.max_product_l, point.producto);
  cycle.last_product_l = point.producto;
  cycle.point_count++;
  cycle.reset_zero_count = 0;
  cycle.reset_at = null;
  cycle.reset_ms = null;

  if (point.temp !== null) {
    cycle.temp_sum += point.temp;
    cycle.temp_count++;
  }

  if (point.cierres !== null) {
    cycle.cierres_values.push(point.cierres);
  }

  if (point.errores !== null) {
    cycle.errores_values.push(point.errores);
  }
}

function markPasteurizadorResetPoint(cycle, point) {
  if (!cycle.reset_at) {
    cycle.reset_at = point.timestamp;
    cycle.reset_ms = point.timestampMs;
  }
  cycle.reset_zero_count++;
}

function finalizePasteurizadorCycle(cycle) {
  const volume = roundNumber(cycle.max_product_l, 0) ?? 0;
  const endAt = cycle.reset_at || cycle.end_at;
  const endMs = cycle.reset_ms || cycle.end_ms;
  const durationMinutes = Math.max(1, Math.round((endMs - cycle.start_ms) / 60000) + 1);
  const avgTemp = cycle.temp_count ? cycle.temp_sum / cycle.temp_count : null;
  const valid = volume >= PASTEURIZADOR_BATCH_MIN_L && volume <= PASTEURIZADOR_BATCH_MAX_L;
  const valveClosures = countCounterWindowEvents(cycle.cierres_values);

  return {
    valid,
    batch: {
      start_at: cycle.start_at,
      end_at: endAt,
      duration_min: durationMinutes,
      volume_l: volume,
      temp_promedio_c: avgTemp === null ? null : roundNumber(avgTemp, 1),
      cierres_valvula: valveClosures,
      errores_criticos: countCounterWindowEvents(cycle.errores_values),
      status: 'completado',
      temp_points: cycle.temp_count,
      puntos: cycle.point_count,
    },
    discard_reason: valid
      ? null
      : volume < PASTEURIZADOR_BATCH_MIN_L
        ? 'volumen_bajo'
        : 'volumen_alto',
  };
}

function countPositiveCounterEvents(values) {
  let total = 0;
  let previous = null;

  for (const value of values) {
    if (value === null) continue;
    const current = Math.max(0, value);

    if (previous === null) {
      total += current;
    } else if (current >= previous) {
      total += current - previous;
    } else {
      total += current;
    }

    previous = current;
  }

  return Math.round(total);
}

function countCounterWindowEvents(values) {
  if (!values.length) return 0;

  let total = 0;
  let previous = Math.max(0, values[0]);

  for (const value of values.slice(1)) {
    if (value === null) continue;
    const current = Math.max(0, value);

    if (current >= previous) total += current - previous;
    else total += current;

    previous = current;
  }

  return Math.round(total);
}

function calculatePasteurizadorDailyKpis(rows) {
  const points = rows
    .map((row) => ({
      timestamp: row.timestamp,
      timestampMs: new Date(row.timestamp).getTime(),
      producto: readHistoryMetricNumber(row, 'salida_producto_tina'),
      temp: readHistoryMetricNumber(row, 'temperatura_pasteurizacion'),
      cierres: readHistoryMetricNumber(row, 'cierres_valvula'),
      errores: readHistoryMetricNumber(row, 'errores_criticos'),
    }))
    .filter((point) => Number.isFinite(point.timestampMs));

  const validBatches = [];
  const discarded = [];
  let cycle = null;

  const closeCycle = () => {
    if (!cycle) return;
    const result = finalizePasteurizadorCycle(cycle);
    if (result.valid) validBatches.push(result.batch);
    else discarded.push(result);
    cycle = null;
  };

  for (const point of points) {
    const product = point.producto;
    if (product === null || product < 0) continue;

    const activeProduct = product > PASTEURIZADOR_PRODUCT_ACTIVE_EPSILON_L;
    if (!cycle) {
      if (activeProduct) {
        cycle = createPasteurizadorCycle({
          ...point,
          producto: product,
          temp:
            point.temp !== null && point.temp >= PASTEURIZADOR_OPERATION_TEMP_MIN_C
              ? point.temp
              : null,
        });
      }
      continue;
    }

    const previous = cycle.last_product_l;

    if (!activeProduct) {
      markPasteurizadorResetPoint(cycle, point);
      if (cycle.reset_zero_count >= PASTEURIZADOR_PRODUCT_RESET_CONFIRM_POINTS) {
        closeCycle();
      }
      continue;
    }

    const largeReset = product + PASTEURIZADOR_PRODUCT_RESET_DROP_L < previous;

    if (largeReset) {
      closeCycle();
      cycle = createPasteurizadorCycle({
        ...point,
        producto: product,
        temp:
          point.temp !== null && point.temp >= PASTEURIZADOR_OPERATION_TEMP_MIN_C
            ? point.temp
            : null,
      });
      continue;
    }

    updatePasteurizadorCycle(cycle, {
      ...point,
      producto: product,
      temp:
        point.temp !== null && point.temp >= PASTEURIZADOR_OPERATION_TEMP_MIN_C ? point.temp : null,
    });
  }

  const productionTotal = validBatches.reduce((sum, batch) => sum + batch.volume_l, 0);
  const tempWeighted = validBatches.reduce(
    (acc, batch) => {
      if (batch.temp_promedio_c !== null && batch.temp_points > 0) {
        acc.sum += batch.temp_promedio_c * batch.temp_points;
        acc.count += batch.temp_points;
      }
      return acc;
    },
    { sum: 0, count: 0 },
  );
  const operationMinutes = validBatches.reduce((sum, batch) => sum + batch.duration_min, 0);
  const alarms = countPositiveCounterEvents(points.map((point) => point.errores));

  return {
    kpis: {
      production_total_l: roundNumber(productionTotal, 0) ?? 0,
      pasteurization_avg_c: tempWeighted.count
        ? roundNumber(tempWeighted.sum / tempWeighted.count, 1)
        : null,
      operation_minutes: operationMinutes,
      valid_batches: validBatches.length,
      alarms_count: alarms,
      discarded_cycles: discarded.length,
      batch_rules: {
        min_l: PASTEURIZADOR_BATCH_MIN_L,
        max_l: PASTEURIZADOR_BATCH_MAX_L,
        operation_temp_min_c: PASTEURIZADOR_OPERATION_TEMP_MIN_C,
        reset_confirm_points: PASTEURIZADOR_PRODUCT_RESET_CONFIRM_POINTS,
      },
    },
    batches: validBatches.map((batch, index) => ({
      id: index + 1,
      ...batch,
    })),
  };
}

async function getSiteById(siteId) {
  const { rows } = await db.query(`SELECT ${SITE_COLUMNS} FROM sitio WHERE id = $1`, [siteId]);
  return rows[0] || null;
}

async function getMappingsBySiteId(siteId) {
  const { rows } = await db.query(
    `SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`,
    [siteId],
  );
  return rows;
}

async function loadLatestEquipoSample(idSerial) {
  if (!idSerial) return null;

  const recent = await db.query(
    `
    SELECT time, received_at, id_serial, data
    FROM equipo
    WHERE id_serial = $1
      AND time >= NOW() - INTERVAL '7 days'
    ORDER BY time DESC
    LIMIT 1
    `,
    [idSerial],
  );
  if (recent.rows[0]) return recent.rows[0];

  const lastBucket = await db.query(
    `
    SELECT bucket
    FROM equipo_daily
    WHERE id_serial = $1
    ORDER BY bucket DESC
    LIMIT 1
    `,
    [idSerial],
  );
  const bucket = lastBucket.rows[0]?.bucket;
  if (!bucket) return null;

  const fallback = await db.query(
    `
    SELECT time, received_at, id_serial, data
    FROM equipo
    WHERE id_serial = $1
      AND time >= $2
      AND time <  $2 + INTERVAL '1 day'
    ORDER BY time DESC
    LIMIT 1
    `,
    [idSerial, bucket],
  );
  return fallback.rows[0] || null;
}

function buildPasteurizadorSnapshotPayload(site, mappings, latest) {
  const dashboard = buildDashboardForRaw(site, mappings, latest);
  const variables = buildPasteurizadorVariableMap(
    dashboard.variables || [],
    PASTEURIZADOR_ROLE_IDS,
  );

  return {
    server_time: toUtcIsoString(new Date()),
    site: serializeSite(site),
    ultima_lectura: dashboard.ultima_lectura,
    estado_operativo: deriveOperationalStatus(variables, latest),
    variables,
    metadata: {
      roles: PASTEURIZADOR_ROLE_DEFS,
      source: 'equipo',
    },
  };
}

async function loadPasteurizadorSnapshot(site) {
  const [mappings, latest] = await Promise.all([
    getMappingsBySiteId(site.id),
    loadLatestEquipoSample(site.id_serial),
  ]);

  return buildPasteurizadorSnapshotPayload(site, mappings, latest);
}

async function loadPasteurizadorBundleInputs(site) {
  const cachedInputs = getCachedPasteurizadorBundleInputs(site.id);
  if (cachedInputs) {
    return { inputs: cachedInputs, fromCache: true };
  }

  const inflightKey = pasteurizadorBundleInputsCacheKey(site.id);
  let inputsPromise = pasteurizadorBundleInputsInflight.get(inflightKey);
  if (!inputsPromise) {
    inputsPromise = Promise.all([
      getMappingsBySiteId(site.id),
      loadLatestEquipoSample(site.id_serial),
    ])
      .then(([mappings, latest]) => {
        const inputs = { mappings, latest };
        setCachedPasteurizadorBundleInputs(site.id, inputs);
        return inputs;
      })
      .finally(() => {
        pasteurizadorBundleInputsInflight.delete(inflightKey);
      });
    pasteurizadorBundleInputsInflight.set(inflightKey, inputsPromise);
  }

  return { inputs: await inputsPromise, fromCache: false };
}

async function loadPasteurizadorBundle(site, options) {
  const { limit, granularity, roles } = options;
  const granConfig = PASTEURIZADOR_HISTORY_GRANULARITY[granularity];

  const inputsPromise = loadPasteurizadorBundleInputs(site);
  const historyPromise = db.query(
    `
    SELECT bucket AS time, received_at, id_serial, data
    FROM ${granConfig.view}
    WHERE id_serial = $1
      AND bucket >= now() - INTERVAL '48 hours'
    ORDER BY bucket DESC
    LIMIT $2
    `,
    [site.id_serial, limit],
  );

  const [{ inputs, fromCache }, historyRes] = await Promise.all([inputsPromise, historyPromise]);
  const { mappings, latest } = inputs;
  let historyRows = historyRes.rows;

  if (historyRows.length === 0) {
    const fallback = await db.query(
      `
      SELECT
        time_bucket($3::interval, time) AS time,
        last(received_at, time)         AS received_at,
        last(id_serial, time)           AS id_serial,
        last(data, time)                AS data
      FROM equipo
      WHERE id_serial = $1
        AND time >= now() - INTERVAL '2 hours'
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT $2
      `,
      [site.id_serial, limit, granConfig.bucketInterval],
    );
    historyRows = fallback.rows;
  }

  const rows = historyRows.map((rawRow) => buildHistoryRow({ site, mappings, rawRow, roles }));

  return {
    snapshot: buildPasteurizadorSnapshotPayload(site, mappings, latest),
    history: {
      site: serializeSite(site),
      rows,
      pagination: {
        limit,
        page: 1,
        total: null,
        total_pages: 1,
        has_more: rows.length === limit,
        granularity,
        source: granConfig.view,
      },
    },
    server_time: toUtcIsoString(new Date()),
    cache: {
      inputs: fromCache ? 'hit' : 'miss',
    },
  };
}

async function loadPasteurizadorHistory(site, options) {
  const { from, to, limit, page, granularity, roles } = options;
  const granConfig = PASTEURIZADOR_HISTORY_GRANULARITY[granularity];
  const offset = (page - 1) * limit;
  const mappingsPromise = getMappingsBySiteId(site.id);
  const useRange = Boolean(from && to);
  const rangeParams = [site.id_serial, from, to, limit, offset];

  const historyPromise = useRange
    ? db.query(
        `
        WITH latest_cagg AS (
          SELECT max(bucket) AS max_bucket
          FROM ${granConfig.view}
          WHERE id_serial = $1
            AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        ),
        recent_raw AS (
          SELECT
            time_bucket($6::interval, e.time) AS time,
            last(e.received_at, e.time)       AS received_at,
            last(e.id_serial, e.time)         AS id_serial,
            last(e.data, e.time)              AS data
          FROM equipo e
          CROSS JOIN latest_cagg lc
          WHERE e.id_serial = $1
            AND e.time >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND e.time <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND (lc.max_bucket IS NULL OR e.time >= lc.max_bucket + $6::interval)
          GROUP BY 1
        ),
        materialized AS (
          SELECT bucket AS time, received_at, id_serial, data
          FROM ${granConfig.view}
          WHERE id_serial = $1
            AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        )
        SELECT time, received_at, id_serial, data
        FROM (
          SELECT * FROM recent_raw
          UNION ALL
          SELECT * FROM materialized
        ) history
        ORDER BY time DESC
        LIMIT $4 OFFSET $5
        `,
        [...rangeParams, granConfig.bucketInterval],
      )
    : db.query(
        `
        WITH latest_cagg AS (
          SELECT max(bucket) AS max_bucket
          FROM ${granConfig.view}
          WHERE id_serial = $1
            AND bucket >= now() - INTERVAL '48 hours'
        ),
        recent_raw AS (
          SELECT
            time_bucket($4::interval, e.time) AS time,
            last(e.received_at, e.time)       AS received_at,
            last(e.id_serial, e.time)         AS id_serial,
            last(e.data, e.time)              AS data
          FROM equipo e
          CROSS JOIN latest_cagg lc
          WHERE e.id_serial = $1
            AND e.time >= COALESCE(lc.max_bucket + $4::interval, now() - INTERVAL '2 hours')
          GROUP BY 1
        ),
        materialized AS (
          SELECT bucket AS time, received_at, id_serial, data
          FROM ${granConfig.view}
          WHERE id_serial = $1
            AND bucket >= now() - INTERVAL '48 hours'
        )
        SELECT time, received_at, id_serial, data
        FROM (
          SELECT * FROM recent_raw
          UNION ALL
          SELECT * FROM materialized
        ) history
        ORDER BY time DESC
        LIMIT $2 OFFSET $3
        `,
        [site.id_serial, limit, offset, granConfig.bucketInterval],
      );

  const countPromise = useRange
    ? db.query(
        `
        WITH latest_cagg AS (
          SELECT max(bucket) AS max_bucket
          FROM ${granConfig.view}
          WHERE id_serial = $1
            AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        ),
        recent_raw AS (
          SELECT time_bucket($4::interval, e.time) AS time
          FROM equipo e
          CROSS JOIN latest_cagg lc
          WHERE e.id_serial = $1
            AND e.time >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND e.time <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND (lc.max_bucket IS NULL OR e.time >= lc.max_bucket + $4::interval)
          GROUP BY 1
        ),
        materialized AS (
          SELECT bucket AS time
          FROM ${granConfig.view}
          WHERE id_serial = $1
            AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        )
        SELECT count(*)::int AS total
        FROM (
          SELECT time FROM recent_raw
          UNION ALL
          SELECT time FROM materialized
        ) history
        `,
        [site.id_serial, from, to, granConfig.bucketInterval],
      )
    : Promise.resolve({ rows: [{ total: null }] });

  let [mappings, historyRes, countRes] = await Promise.all([
    mappingsPromise,
    historyPromise,
    countPromise,
  ]);

  if (!useRange && historyRes.rows.length === 0) {
    historyRes = await db.query(
      `
      SELECT bucket AS time, received_at, id_serial, data
      FROM ${granConfig.view}
      WHERE id_serial = $1
      ORDER BY bucket DESC
      LIMIT $2
      OFFSET $3
      `,
      [site.id_serial, limit, offset],
    );
  }

  if (useRange && historyRes.rows.length === 0) {
    historyRes = await db.query(
      `
      SELECT
        time_bucket($4::interval, time) AS time,
        last(received_at, time)         AS received_at,
        last(id_serial, time)           AS id_serial,
        last(data, time)                AS data
      FROM equipo
      WHERE id_serial = $1
        AND time >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        AND time <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT $5 OFFSET $6
      `,
      [site.id_serial, from, to, granConfig.bucketInterval, limit, offset],
    );
  }

  const rows = historyRes.rows.map((rawRow) => buildHistoryRow({ site, mappings, rawRow, roles }));
  const total = countRes.rows[0]?.total ?? null;

  return {
    site: serializeSite(site),
    rows,
    pagination: {
      limit,
      page,
      total,
      total_pages: total === null ? 1 : Math.max(1, Math.ceil(total / limit)),
      has_more: total === null ? rows.length === limit : offset + rows.length < total,
      granularity,
      source: granConfig.view,
    },
  };
}

async function loadPasteurizadorDailyKpis(site, options) {
  const { date } = options;
  const granConfig = PASTEURIZADOR_HISTORY_GRANULARITY['1m'];
  const [mappings, rowsRes] = await Promise.all([
    getMappingsBySiteId(site.id),
    db.query(
      `
      WITH latest_cagg AS (
        SELECT max(bucket) AS max_bucket
        FROM ${granConfig.view}
        WHERE id_serial = $1
          AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND bucket <  (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
      ),
      recent_raw AS (
        SELECT
          time_bucket($3::interval, e.time) AS time,
          last(e.received_at, e.time)       AS received_at,
          last(e.id_serial, e.time)         AS id_serial,
          last(e.data, e.time)              AS data
        FROM equipo e
        CROSS JOIN latest_cagg lc
        WHERE e.id_serial = $1
          AND e.time >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND e.time <  (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND (lc.max_bucket IS NULL OR e.time >= lc.max_bucket + $3::interval)
        GROUP BY 1
      ),
      materialized AS (
        SELECT bucket AS time, received_at, id_serial, data
        FROM ${granConfig.view}
        WHERE id_serial = $1
          AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND bucket <  (($2::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
      )
      SELECT time, received_at, id_serial, data
      FROM (
        SELECT * FROM recent_raw
        UNION ALL
        SELECT * FROM materialized
      ) history
      ORDER BY time ASC
      `,
      [site.id_serial, date, granConfig.bucketInterval],
    ),
  ]);

  const rows = rowsRes.rows.map((rawRow) =>
    buildHistoryRow({
      site,
      mappings,
      rawRow,
      roles: PASTEURIZADOR_DAILY_KPI_ROLES,
    }),
  );
  const daily = calculatePasteurizadorDailyKpis(rows);

  return {
    site: serializeSite(site),
    date,
    source: granConfig.view,
    samples: rows.length,
    kpis: daily.kpis,
    batches: daily.batches,
  };
}

async function loadPasteurizadorSummary(site, options) {
  const { from, to, granularity, roles } = options;
  const granConfig = PASTEURIZADOR_HISTORY_GRANULARITY[granularity];
  const [mappings, rowsRes] = await Promise.all([
    getMappingsBySiteId(site.id),
    db.query(
      `
      SELECT bucket AS time, received_at, id_serial, data
      FROM ${granConfig.view}
      WHERE id_serial = $1
        AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
      ORDER BY bucket ASC
      `,
      [site.id_serial, from, to],
    ),
  ]);

  const stats = seedSummaryStats(roles);
  for (const rawRow of rowsRes.rows) {
    const row = buildHistoryRow({ site, mappings, rawRow, roles });
    for (const roleId of roles) {
      updateSummaryStats(stats, roleId, row.variables[roleId], row.timestamp);
    }
  }

  return {
    site: serializeSite(site),
    range: { from, to, granularity, source: granConfig.view },
    muestras_total: rowsRes.rows.length,
    resumen: finalizeSummaryStats(stats),
  };
}

module.exports = {
  PASTEURIZADOR_SITE_TYPE,
  PASTEURIZADOR_ROLE_DEFS,
  PASTEURIZADOR_ROLE_IDS,
  PASTEURIZADOR_DEFAULT_HISTORY_ROLES,
  PASTEURIZADOR_HISTORY_GRANULARITY,
  canonicalPasteurizadorRole,
  normalizePasteurizadorRoles,
  getSiteById,
  invalidatePasteurizadorBundleInputsCache,
  loadPasteurizadorBundle,
  loadPasteurizadorDailyKpis,
  loadPasteurizadorSnapshot,
  loadPasteurizadorHistory,
  loadPasteurizadorSummary,
};
