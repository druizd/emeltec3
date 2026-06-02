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

const PASTEURIZADOR_HISTORY_GRANULARITY = Object.freeze({
  '1m': { view: 'equipo_1min', label: '1 minuto', maxDays: 31 },
  '5m': { view: 'equipo_5min', label: '5 minutos', maxDays: 93 },
  '1h': { view: 'equipo_hourly', label: '1 hora', maxDays: 366 },
  '1d': { view: 'equipo_daily', label: '1 dia', maxDays: 1095 },
});

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

async function loadPasteurizadorSnapshot(site) {
  const [mappings, latest] = await Promise.all([
    getMappingsBySiteId(site.id),
    loadLatestEquipoSample(site.id_serial),
  ]);
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

async function loadPasteurizadorHistory(site, options) {
  const { from, to, limit, page, granularity, roles } = options;
  const granConfig = PASTEURIZADOR_HISTORY_GRANULARITY[granularity];
  const offset = (page - 1) * limit;
  const mappingsPromise = getMappingsBySiteId(site.id);
  const useRange = Boolean(from && to);

  const historyPromise = useRange
    ? db.query(
        `
        SELECT bucket AS time, received_at, id_serial, data
        FROM ${granConfig.view}
        WHERE id_serial = $1
          AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        ORDER BY bucket DESC
        LIMIT $4
        OFFSET $5
        `,
        [site.id_serial, from, to, limit, offset],
      )
    : db.query(
        `
        SELECT bucket AS time, received_at, id_serial, data
        FROM ${granConfig.view}
        WHERE id_serial = $1
          AND bucket >= NOW() - INTERVAL '48 hours'
        ORDER BY bucket DESC
        LIMIT $2
        OFFSET $3
        `,
        [site.id_serial, limit, offset],
      );

  const countPromise = useRange
    ? db.query(
        `
        SELECT COUNT(*)::int AS total
        FROM ${granConfig.view}
        WHERE id_serial = $1
          AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        `,
        [site.id_serial, from, to],
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
  loadPasteurizadorSnapshot,
  loadPasteurizadorHistory,
  loadPasteurizadorSummary,
};
