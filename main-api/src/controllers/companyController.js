const crypto = require('crypto');
const zlib = require('zlib');
const { once } = require('events');
const db = require('../config/db');
const {
  buildSiteDashboardData,
  mapHistoricalDashboardRow,
} = require('../services/siteTelemetryService');
const {
  getSiteTypeCatalog,
  SITE_TYPE_IDS,
  VARIABLE_ROLE_IDS,
  VARIABLE_TRANSFORM_IDS,
} = require('../config/siteTypeCatalog');
const { CHILE_TIME_ZONE, formatChileTimestamp } = require('../utils/timezone');
const { formatRutForStorage } = require('../utils/rut');

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, tipo_sitio, activo';
const MAP_COLUMNS =
  'id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id, created_at, updated_at';
const POZO_CONFIG_COLUMNS =
  'sitio_id, profundidad_pozo_m, profundidad_sensor_m, nivel_estatico_manual_m, obra_dga, slug, created_at, updated_at';
const POZO_CONFIG_SELECT_COLUMNS =
  'pc.sitio_id, pc.profundidad_pozo_m, pc.profundidad_sensor_m, pc.nivel_estatico_manual_m, pc.obra_dga, pc.slug, pc.created_at, pc.updated_at';
const CONTACT_COLUMNS = `
  co.id::text,
  co.empresa_id,
  co.sub_empresa_id,
  co.sitio_id,
  co.usuario_id,
  co.nombre,
  co.apellido,
  co.email,
  co.telefono,
  co.cargo,
  co.tipo_contacto,
  co.notas,
  co.created_at,
  co.updated_at,
  u.tipo AS usuario_tipo,
  e.nombre AS empresa_nombre,
  se.nombre AS sub_empresa_nombre,
  s.descripcion AS sitio_nombre
`;
const SITE_TYPES = new Set(SITE_TYPE_IDS);
const VARIABLE_ROLES = new Set(VARIABLE_ROLE_IDS);
const VARIABLE_TRANSFORMS = new Set(VARIABLE_TRANSFORM_IDS);
const DASHBOARD_DATA_CACHE_TTL_MS = 15_000;
const dashboardDataCache = new Map();
const dashboardDataInflight = new Map();

function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message, message });
}

function forbidden(res, message = 'No tiene permisos para realizar esta accion') {
  return res.status(403).json({ ok: false, error: message, message });
}

function notFound(res, message) {
  return res.status(404).json({ ok: false, error: message, message });
}

function conflict(res, message) {
  return res.status(409).json({ ok: false, error: message, message });
}

function cleanString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function nullableString(value) {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function parseLimit(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parsePage(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.floor(parsed);
}

function parseDateOnly(value) {
  const cleaned = cleanString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null;
  const date = new Date(`${cleaned}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : cleaned;
}

function countInclusiveDays(from, to) {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  return Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function normalizeId(value) {
  return cleanString(value).toUpperCase();
}

function normalizeSiteType(value) {
  const normalized = cleanString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalized) return 'pozo';
  if (normalized.includes('camara') || normalized.includes('frio') || normalized.includes('cold')) {
    return 'camara_frio';
  }
  if (normalized.includes('vertiente')) return 'vertiente';
  if (normalized.includes('canal')) return 'canal';
  if (normalized.includes('pozo') || normalized.includes('agua')) return 'pozo';
  if (normalized.includes('elect')) return 'electrico';
  if (normalized.includes('ril')) return 'riles';
  if (normalized.includes('proceso') || normalized.includes('variable')) return 'proceso';
  return SITE_TYPES.has(normalized) ? normalized : null;
}

function normalizeOption(value, allowedValues, fallback) {
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) return fallback;
  return allowedValues.has(normalized) ? normalized : null;
}

function normalizeVariableRole(value) {
  return normalizeOption(value, VARIABLE_ROLES, 'generico');
}

function normalizeVariableTransform(value) {
  const normalized = normalizeOption(value, VARIABLE_TRANSFORMS, 'directo');
  if (!normalized) return null;
  if (normalized === 'escala_lineal') return 'lineal';
  if (normalized === 'ieee754') return 'ieee754_32';
  if (normalized === 'caudal') return 'caudal_m3h_lps';
  if (normalized === 'uint32') return 'uint32_registros';
  return normalized;
}

function parseJsonObject(value) {
  if (value === undefined || value === null || value === '') return {};
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (_err) {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}
function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'yes', 'activo'].includes(String(value).trim().toLowerCase());
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function freshUtcTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function dashboardDataCacheKey(siteId) {
  return normalizeId(siteId);
}

function getCachedDashboardData(cacheKey) {
  const cached = dashboardDataCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    dashboardDataCache.delete(cacheKey);
    return null;
  }
  return {
    ...cached.data,
    server_time: freshUtcTimestamp(),
  };
}

function setCachedDashboardData(cacheKey, data) {
  dashboardDataCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + DASHBOARD_DATA_CACHE_TTL_MS,
  });
}

function isSuperAdmin(user) {
  return user?.tipo === 'SuperAdmin';
}

function requireSuperAdmin(req, res) {
  if (isSuperAdmin(req.user)) return false;
  return forbidden(res, 'Solo un SuperAdmin puede administrar empresas, sitios y variables.');
}

function canReadSite(user, site) {
  if (!user || !site) return false;
  if (user.tipo === 'SuperAdmin') return true;
  if (user.tipo === 'Admin') return user.empresa_id === site.empresa_id;
  if (user.tipo === 'Gerente' || user.tipo === 'Cliente') {
    return user.empresa_id === site.empresa_id && user.sub_empresa_id === site.sub_empresa_id;
  }
  return false;
}

function canReadTenantScope(user, scope) {
  if (!user || !scope) return false;
  if (user.tipo === 'SuperAdmin') return true;
  if (user.tipo === 'Admin') return user.empresa_id === scope.empresa_id;
  if (user.tipo === 'Gerente' || user.tipo === 'Cliente') {
    return user.empresa_id === scope.empresa_id && user.sub_empresa_id === scope.sub_empresa_id;
  }
  return false;
}

function canMutateOperationalContacts(user, scope) {
  if (!user || user.tipo === 'Cliente') return false;
  return canReadTenantScope(user, scope);
}

function utcTimestampSql(column) {
  return `TO_CHAR(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

const HISTORY_EXPORT_FIELDS = {
  caudal: 'Caudal',
  nivel: 'Nivel',
  totalizador: 'Totalizador',
  nivel_freatico: 'Nivel Freatico',
};

function parseHistoryExportFields(value) {
  const selected = cleanString(value)
    .split(',')
    .map((field) => field.trim().toLowerCase())
    .filter((field) => Object.prototype.hasOwnProperty.call(HISTORY_EXPORT_FIELDS, field));

  return selected.length
    ? [...new Set(selected)]
    : ['caudal', 'nivel', 'totalizador', 'nivel_freatico'];
}

const HISTORY_EXPORT_GRANULARITY = {
  '1m': { view: 'equipo_1min', bucketInterval: '1 minute' },
  '1h': { view: 'equipo_hourly', bucketInterval: '1 hour' },
  '1d': { view: 'equipo_daily', bucketInterval: '1 day' },
};

function parseHistoryExportGranularity(value) {
  const key = cleanString(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(HISTORY_EXPORT_GRANULARITY, key) ? key : '1m';
}

function dashboardHistoryGranularity() {
  return '1m';
}

function csvCell(value, delimiter = ';') {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /["\r\n;]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvValue(variable) {
  if (
    !variable ||
    variable.ok === false ||
    variable.valor === null ||
    variable.valor === undefined
  ) {
    return '';
  }

  const num = Number(variable.valor);
  if (Number.isFinite(num) && String(variable.valor).trim() !== '') {
    return String(parseFloat(num.toFixed(2)));
  }

  return variable.valor;
}

function exportFileName(site, from, to, format) {
  const siteLabel =
    cleanString(site?.descripcion || site?.id || 'sitio')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'sitio';
  return `${siteLabel}_historico_${from}_${to}.${format}`;
}

async function writeResponseChunk(res, chunk) {
  if (!res.write(chunk)) {
    await once(res, 'drain');
  }
}

async function generateSequentialId(client, table, prefix) {
  const allowedTables = new Set(['empresa', 'sub_empresa', 'sitio']);
  if (!allowedTables.has(table)) {
    throw new Error('Tabla no permitida para generar id');
  }

  const { rows } = await client.query(`SELECT id FROM ${table} WHERE id LIKE $1`, [`${prefix}%`]);

  const idPattern = new RegExp(`^${prefix}(\\d+)$`);
  const lastNumber = rows.reduce((max, row) => {
    const match = idPattern.exec(row.id);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 99);

  return `${prefix}${lastNumber + 1}`;
}

function generateMapId() {
  return `RM${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function getCompanyById(id) {
  const { rows } = await db.query(
    'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

async function getSubCompanyById(id) {
  const { rows } = await db.query(
    'SELECT id, nombre, rut, sitios, empresa_id FROM sub_empresa WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

async function getSiteById(id) {
  const { rows } = await db.query(`SELECT ${SITE_COLUMNS} FROM sitio WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getPozoConfigBySiteId(siteId) {
  const { rows } = await db.query(
    `SELECT ${POZO_CONFIG_SELECT_COLUMNS}
       FROM pozo_config pc
       JOIN sitio s ON s.id = pc.sitio_id
      WHERE pc.sitio_id = $1
        AND s.tipo_sitio = 'pozo'`,
    [siteId],
  );
  return rows[0] || null;
}

const LATEST_EQUIPO_COLUMNS = `
        time,
        received_at,
        id_serial,
        data,
        ${utcTimestampSql('time')} AS timestamp_completo`;

// Sin bound de time, TimescaleDB enumera todos los chunks del hypertable en el
// plan -> planning ~1.5s. Primero intentamos la ventana corta (cubre 99% de
// los pozos activos); si el equipo lleva mas tiempo sin reportar, usamos el
// cagg equipo_daily para localizar el ultimo bucket y leer solo ese chunk.
async function loadLatestEquipoSample(idSerial) {
  if (!idSerial) return null;

  const recent = await db.query(
    `SELECT${LATEST_EQUIPO_COLUMNS}
       FROM equipo
      WHERE id_serial = $1
        AND time >= NOW() - INTERVAL '7 days'
      ORDER BY time DESC
      LIMIT 1`,
    [idSerial],
  );
  if (recent.rows[0]) return recent.rows[0];

  const lastBucket = await db.query(
    `SELECT bucket
       FROM equipo_daily
      WHERE id_serial = $1
      ORDER BY bucket DESC
      LIMIT 1`,
    [idSerial],
  );
  const bucket = lastBucket.rows[0]?.bucket;
  if (!bucket) return null;

  const fallback = await db.query(
    `SELECT${LATEST_EQUIPO_COLUMNS}
       FROM equipo
      WHERE id_serial = $1
        AND time >= $2
        AND time <  $2 + INTERVAL '1 day'
      ORDER BY time DESC
      LIMIT 1`,
    [idSerial, bucket],
  );
  return fallback.rows[0] || null;
}

async function loadSiteDashboardData(siteId, site) {
  const [pozoConfigRes, mappingsRes, latest] = await Promise.all([
    db.query(
      `SELECT ${POZO_CONFIG_SELECT_COLUMNS}
         FROM pozo_config pc
         JOIN sitio s ON s.id = pc.sitio_id
        WHERE pc.sitio_id = $1
          AND s.tipo_sitio = 'pozo'`,
      [siteId],
    ),
    db.query(`SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`, [siteId]),
    loadLatestEquipoSample(site.id_serial),
  ]);

  return buildSiteDashboardData({
    site,
    pozoConfig: pozoConfigRes.rows[0] || null,
    mappings: mappingsRes.rows,
    latest,
  });
}

async function attachPozoConfigsToSites(sites) {
  if (!sites.length) return sites;

  const siteIds = sites.map((site) => site.id);
  const { rows } = await db.query(
    `SELECT ${POZO_CONFIG_SELECT_COLUMNS}
       FROM pozo_config pc
       JOIN sitio s ON s.id = pc.sitio_id
      WHERE pc.sitio_id = ANY($1::text[])
        AND s.tipo_sitio = 'pozo'`,
    [siteIds],
  );
  const configsBySiteId = new Map(rows.map((row) => [row.sitio_id, row]));

  return sites.map((site) => ({
    ...site,
    pozo_config: configsBySiteId.get(site.id) || null,
  }));
}

async function upsertPozoConfig(client, siteId, rawConfig = {}) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  // PATCH parcial: solo actualiza los campos presentes en el body. Si el
  // caller manda solo { obra_dga: 'OB-...' }, no debe nullear las
  // profundidades o el slug. Detectamos presencia con Object.hasOwn().
  //
  // Insertion (cuando no existe row): los campos no presentes quedan NULL
  // (es lo esperado, no había data previa).
  // Update (cuando existe row): los campos no presentes se preservan via
  // COALESCE con el valor anterior (EXCLUDED para insert vs pozo_config.*
  // para update).
  const hasProfPozo = Object.prototype.hasOwnProperty.call(source, 'profundidad_pozo_m');
  const hasProfSensor = Object.prototype.hasOwnProperty.call(source, 'profundidad_sensor_m');
  const hasNivelEstatico = Object.prototype.hasOwnProperty.call(source, 'nivel_estatico_manual_m');
  const hasObraDga = Object.prototype.hasOwnProperty.call(source, 'obra_dga');
  const hasSlug = Object.prototype.hasOwnProperty.call(source, 'slug');

  const profPozo = hasProfPozo ? parseOptionalNumber(source.profundidad_pozo_m) : null;
  const profSensor = hasProfSensor ? parseOptionalNumber(source.profundidad_sensor_m) : null;
  const nivelEstatico = hasNivelEstatico
    ? parseOptionalNumber(source.nivel_estatico_manual_m)
    : null;
  const obraDga = hasObraDga ? nullableString(source.obra_dga) : null;
  const slug = hasSlug ? nullableString(source.slug) : null;

  const { rows } = await client.query(
    `INSERT INTO pozo_config
       (sitio_id, profundidad_pozo_m, profundidad_sensor_m, nivel_estatico_manual_m, obra_dga, slug)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sitio_id) DO UPDATE SET
       profundidad_pozo_m      = CASE WHEN $7  THEN EXCLUDED.profundidad_pozo_m      ELSE pozo_config.profundidad_pozo_m      END,
       profundidad_sensor_m    = CASE WHEN $8  THEN EXCLUDED.profundidad_sensor_m    ELSE pozo_config.profundidad_sensor_m    END,
       nivel_estatico_manual_m = CASE WHEN $9  THEN EXCLUDED.nivel_estatico_manual_m ELSE pozo_config.nivel_estatico_manual_m END,
       obra_dga                = CASE WHEN $10 THEN EXCLUDED.obra_dga                ELSE pozo_config.obra_dga                END,
       slug                    = CASE WHEN $11 THEN EXCLUDED.slug                    ELSE pozo_config.slug                    END,
       updated_at              = NOW()
     RETURNING ${POZO_CONFIG_COLUMNS}`,
    [
      siteId,
      profPozo,
      profSensor,
      nivelEstatico,
      obraDga,
      slug,
      hasProfPozo,
      hasProfSensor,
      hasNivelEstatico,
      hasObraDga,
      hasSlug,
    ],
  );

  return rows[0] || null;
}

async function ensureSerialAvailable(serialId, currentSiteId = null) {
  if (!serialId) return null;

  const params = [serialId];
  let query = 'SELECT id, descripcion FROM sitio WHERE id_serial = $1';

  if (currentSiteId) {
    params.push(currentSiteId);
    query += ` AND id <> $${params.length}`;
  }

  query += ' LIMIT 1';

  const { rows } = await db.query(query, params);
  return rows[0] || null;
}

async function refreshCompanySiteCount(client, companyId) {
  if (!companyId) return;
  await client.query(
    `UPDATE empresa
     SET sitios = (SELECT COUNT(*) FROM sitio WHERE empresa_id = $1),
         updated_at = NOW()
     WHERE id = $1`,
    [companyId],
  );
}

async function refreshSubCompanySiteCount(client, subCompanyId) {
  if (!subCompanyId) return;
  await client.query(
    `UPDATE sub_empresa
     SET sitios = (SELECT COUNT(*) FROM sitio WHERE sub_empresa_id = $1),
         updated_at = NOW()
     WHERE id = $1`,
    [subCompanyId],
  );
}

function handleUniqueViolation(err, res) {
  if (err.code !== '23505') return false;

  const detail = err.detail || '';
  if (detail.includes('rut')) {
    conflict(res, 'Ya existe un registro con ese RUT.');
    return true;
  }

  conflict(res, 'Ya existe un registro con esos datos.');
  return true;
}

/**
 * GET /api/companies/tree
 *
 * Modelo de jerarquia:
 * empresa -> sub_empresa -> sitio
 */
exports.getHierarchyTree = async (req, res, next) => {
  try {
    const { tipo, empresa_id, sub_empresa_id } = req.user;

    let companies = [];
    let subCompanies = [];
    let sites = [];

    if (tipo === 'SuperAdmin') {
      const compRes = await db.query(
        'SELECT id, nombre, rut, tipo_empresa FROM empresa ORDER BY nombre ASC',
      );
      const subRes = await db.query(
        'SELECT id, nombre, rut, empresa_id FROM sub_empresa ORDER BY nombre ASC',
      );
      const siteRes = await db.query(`SELECT ${SITE_COLUMNS} FROM sitio ORDER BY descripcion ASC`);

      companies = compRes.rows;
      subCompanies = subRes.rows;
      sites = siteRes.rows;
    } else if (tipo === 'Admin') {
      if (!empresa_id) {
        return res.json({ ok: true, data: [] });
      }

      const compRes = await db.query(
        'SELECT id, nombre, rut, tipo_empresa FROM empresa WHERE id = $1',
        [empresa_id],
      );
      const subRes = await db.query(
        'SELECT id, nombre, rut, empresa_id FROM sub_empresa WHERE empresa_id = $1 ORDER BY nombre ASC',
        [empresa_id],
      );
      const siteRes = await db.query(
        `SELECT ${SITE_COLUMNS} FROM sitio WHERE empresa_id = $1 ORDER BY descripcion ASC`,
        [empresa_id],
      );

      companies = compRes.rows;
      subCompanies = subRes.rows;
      sites = siteRes.rows;
    } else if (tipo === 'Gerente' || tipo === 'Cliente') {
      if (!empresa_id || !sub_empresa_id) {
        return res.json({ ok: true, data: [] });
      }

      const compRes = await db.query(
        'SELECT id, nombre, rut, tipo_empresa FROM empresa WHERE id = $1',
        [empresa_id],
      );
      const subRes = await db.query(
        'SELECT id, nombre, rut, empresa_id FROM sub_empresa WHERE id = $1 AND empresa_id = $2',
        [sub_empresa_id, empresa_id],
      );
      const siteRes = await db.query(
        `SELECT ${SITE_COLUMNS} FROM sitio WHERE sub_empresa_id = $1 ORDER BY descripcion ASC`,
        [sub_empresa_id],
      );

      companies = compRes.rows;
      subCompanies = subRes.rows;
      sites = siteRes.rows;
    } else {
      return res.status(403).json({ ok: false, error: 'Rol no reconocido' });
    }

    sites = await attachPozoConfigsToSites(sites);

    const tree = companies.map((company) => ({
      ...company,
      subCompanies: subCompanies
        .filter((subCompany) => subCompany.empresa_id === company.id)
        .map((subCompany) => ({
          ...subCompany,
          sites: sites.filter((site) => site.sub_empresa_id === subCompany.id),
        })),
    }));

    res.json({ ok: true, data: tree });
  } catch (err) {
    console.error('Error en getHierarchyTree:', err);
    next(err);
  }
};

/**
 * GET /api/companies
 * Lista plana de empresas, filtrada por rol.
 */
exports.getAllCompanies = async (req, res, next) => {
  try {
    const { tipo, empresa_id } = req.user;
    let query;
    let params;

    if (tipo === 'SuperAdmin') {
      query = 'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa ORDER BY nombre ASC';
      params = [];
    } else {
      query =
        'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa WHERE id = $1 ORDER BY nombre ASC';
      params = [empresa_id];
    }

    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/companies
 * Crea una empresa padre. Solo SuperAdmin.
 */
exports.createCompany = async (req, res, next) => {
  const client = await db.connect();

  try {
    if (!isSuperAdmin(req.user)) {
      return forbidden(res, 'Solo un SuperAdmin puede crear empresas padre');
    }

    const nombre = cleanString(req.body.nombre);
    const rut = formatRutForStorage(req.body.rut);
    const tipoEmpresa = cleanString(req.body.tipo_empresa) || 'Cliente';

    if (!nombre || !rut) {
      return badRequest(res, 'nombre y rut son requeridos.');
    }

    await client.query('BEGIN');

    const requestedId = normalizeId(req.body.id);
    const id = requestedId || (await generateSequentialId(client, 'empresa', 'E'));

    const { rows } = await client.query(
      `INSERT INTO empresa (id, nombre, rut, tipo_empresa)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, rut, sitios, tipo_empresa, created_at, updated_at`,
      [id, nombre, rut, tipoEmpresa],
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      message: 'Empresa creada correctamente.',
      data: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (handleUniqueViolation(err, res)) return;
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/companies/:companyId
 * Actualiza datos basicos de una empresa padre. Solo SuperAdmin.
 */
exports.updateCompany = async (req, res, next) => {
  try {
    const companyId = normalizeId(req.params.companyId);

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const company = await getCompanyById(companyId);
    if (!company) {
      return notFound(res, 'Empresa no encontrada.');
    }

    const updates = [];
    const params = [];

    const fields = [
      ['nombre', req.body.nombre === undefined ? undefined : cleanString(req.body.nombre)],
      ['rut', req.body.rut === undefined ? undefined : formatRutForStorage(req.body.rut)],
      [
        'tipo_empresa',
        req.body.tipo_empresa === undefined ? undefined : cleanString(req.body.tipo_empresa),
      ],
    ];

    for (const [field, value] of fields) {
      if (value === undefined) continue;
      if (!value) {
        return badRequest(res, `${field} no puede quedar vacio.`);
      }
      params.push(value);
      updates.push(`${field} = $${params.length}`);
    }

    if (!updates.length) {
      return badRequest(res, 'Debe enviar al menos un campo para actualizar.');
    }

    params.push(companyId);
    const { rows } = await db.query(
      `UPDATE empresa
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, nombre, rut, sitios, tipo_empresa, created_at, updated_at`,
      params,
    );

    res.json({
      ok: true,
      message: 'Empresa actualizada correctamente.',
      data: rows[0],
    });
  } catch (err) {
    if (handleUniqueViolation(err, res)) return;
    next(err);
  }
};

/**
 * DELETE /api/companies/:companyId
 * Elimina una empresa padre y sus subempresas/sitios asociados por cascada.
 */
exports.deleteCompany = async (req, res, next) => {
  const client = await db.connect();

  try {
    const companyId = normalizeId(req.params.companyId);

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    await client.query('BEGIN');
    await client.query(
      'DELETE FROM reg_map WHERE sitio_id IN (SELECT id FROM sitio WHERE empresa_id = $1)',
      [companyId],
    );
    const { rows } = await client.query('DELETE FROM empresa WHERE id = $1 RETURNING id, nombre', [
      companyId,
    ]);

    if (!rows.length) {
      await client.query('ROLLBACK').catch(() => {});
      return notFound(res, 'Empresa no encontrada.');
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Empresa eliminada correctamente.',
      data: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

/**
 * POST /api/companies/:companyId/sub-companies
 * Crea una subempresa dentro de una empresa padre.
 */
exports.createSubCompany = async (req, res, next) => {
  const client = await db.connect();

  try {
    const empresaId = normalizeId(req.params.companyId);

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const nombre = cleanString(req.body.nombre);
    const rut = formatRutForStorage(req.body.rut);

    if (!nombre || !rut) {
      return badRequest(res, 'nombre y rut son requeridos.');
    }

    const company = await getCompanyById(empresaId);
    if (!company) {
      return notFound(res, 'Empresa no encontrada.');
    }

    await client.query('BEGIN');

    const requestedId = normalizeId(req.body.id);
    const id = requestedId || (await generateSequentialId(client, 'sub_empresa', 'SE'));

    const { rows } = await client.query(
      `INSERT INTO sub_empresa (id, nombre, rut, empresa_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, rut, sitios, empresa_id, created_at, updated_at`,
      [id, nombre, rut, empresaId],
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      message: 'Subempresa creada correctamente.',
      data: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (handleUniqueViolation(err, res)) return;
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/companies/:companyId/sub-companies/:subCompanyId
 * Actualiza una subempresa. Si cambia de empresa padre, mueve tambien sus sitios.
 */
exports.updateSubCompany = async (req, res, next) => {
  const client = await db.connect();

  try {
    const empresaId = normalizeId(req.params.companyId);
    const subEmpresaId = normalizeId(req.params.subCompanyId);

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const current = await getSubCompanyById(subEmpresaId);
    if (!current || current.empresa_id !== empresaId) {
      return notFound(res, 'Subempresa no encontrada para esa empresa.');
    }

    const nextEmpresaId =
      req.body.empresa_id === undefined ? current.empresa_id : normalizeId(req.body.empresa_id);
    if (!nextEmpresaId) {
      return badRequest(res, 'empresa_id no puede quedar vacio.');
    }

    const nextCompany = await getCompanyById(nextEmpresaId);
    if (!nextCompany) {
      return notFound(res, 'Empresa destino no encontrada.');
    }

    const fields = [
      ['nombre', req.body.nombre === undefined ? undefined : cleanString(req.body.nombre)],
      ['rut', req.body.rut === undefined ? undefined : formatRutForStorage(req.body.rut)],
      ['empresa_id', nextEmpresaId === current.empresa_id ? undefined : nextEmpresaId],
    ];
    const updates = [];
    const params = [];

    for (const [field, value] of fields) {
      if (value === undefined) continue;
      if (!value) {
        return badRequest(res, `${field} no puede quedar vacio.`);
      }
      params.push(value);
      updates.push(`${field} = $${params.length}`);
    }

    if (!updates.length) {
      return badRequest(res, 'Debe enviar al menos un campo para actualizar.');
    }

    await client.query('BEGIN');

    params.push(subEmpresaId);
    const { rows } = await client.query(
      `UPDATE sub_empresa
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, nombre, rut, sitios, empresa_id, created_at, updated_at`,
      params,
    );

    if (nextEmpresaId !== current.empresa_id) {
      await client.query(
        `UPDATE sitio
         SET empresa_id = $1, updated_at = NOW()
         WHERE sub_empresa_id = $2`,
        [nextEmpresaId, subEmpresaId],
      );
      await refreshCompanySiteCount(client, current.empresa_id);
      await refreshCompanySiteCount(client, nextEmpresaId);
    }

    await refreshSubCompanySiteCount(client, subEmpresaId);
    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Subempresa actualizada correctamente.',
      data: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (handleUniqueViolation(err, res)) return;
    next(err);
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/companies/:companyId/sub-companies/:subCompanyId
 * Elimina una subempresa y sus sitios asociados por cascada.
 */
exports.deleteSubCompany = async (req, res, next) => {
  const client = await db.connect();

  try {
    const empresaId = normalizeId(req.params.companyId);
    const subEmpresaId = normalizeId(req.params.subCompanyId);

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const current = await getSubCompanyById(subEmpresaId);
    if (!current || current.empresa_id !== empresaId) {
      return notFound(res, 'Subempresa no encontrada para esa empresa.');
    }

    await client.query('BEGIN');
    await client.query(
      'DELETE FROM reg_map WHERE sitio_id IN (SELECT id FROM sitio WHERE sub_empresa_id = $1)',
      [subEmpresaId],
    );
    const { rows } = await client.query(
      'DELETE FROM sub_empresa WHERE id = $1 RETURNING id, nombre',
      [subEmpresaId],
    );
    await refreshCompanySiteCount(client, empresaId);
    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Subempresa eliminada correctamente.',
      data: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

/**
 * POST /api/companies/:companyId/sub-companies/:subCompanyId/sites
 * Crea un sitio y lo deja asociado a un equipo/serial.
 */
exports.createSite = async (req, res, next) => {
  const client = await db.connect();

  try {
    const empresaId = normalizeId(req.params.companyId);
    const subEmpresaId = normalizeId(req.params.subCompanyId);

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const descripcion = cleanString(req.body.descripcion || req.body.nombre);
    const idSerial = cleanString(req.body.id_serial || req.body.serial_id);
    const ubicacion = nullableString(req.body.ubicacion);
    const tipoSitio = normalizeSiteType(req.body.tipo_sitio);
    const activo = parseBoolean(req.body.activo, true);

    if (!descripcion || !idSerial) {
      return badRequest(res, 'descripcion e id_serial son requeridos.');
    }

    if (!tipoSitio) {
      return badRequest(
        res,
        'tipo_sitio debe ser pozo, vertiente, canal, electrico, riles, camara_frio, proceso o generico.',
      );
    }

    const subCompany = await getSubCompanyById(subEmpresaId);
    if (!subCompany || subCompany.empresa_id !== empresaId) {
      return notFound(res, 'Subempresa no encontrada para esa empresa.');
    }

    const serialOwner = await ensureSerialAvailable(idSerial);
    if (serialOwner) {
      return conflict(res, `El serial ${idSerial} ya esta asignado al sitio ${serialOwner.id}.`);
    }

    await client.query('BEGIN');

    const requestedId = normalizeId(req.body.id);
    const id = requestedId || (await generateSequentialId(client, 'sitio', 'S'));

    const { rows } = await client.query(
      `INSERT INTO sitio (id, descripcion, id_serial, empresa_id, sub_empresa_id, ubicacion, tipo_sitio, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SITE_COLUMNS}, created_at, updated_at`,
      [id, descripcion, idSerial, empresaId, subEmpresaId, ubicacion, tipoSitio, activo],
    );

    let pozoConfig = null;
    if (tipoSitio === 'pozo') {
      pozoConfig = await upsertPozoConfig(client, id, req.body.pozo_config);
    }

    await refreshSubCompanySiteCount(client, subEmpresaId);
    await refreshCompanySiteCount(client, empresaId);

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      message: 'Sitio creado correctamente.',
      data: { ...rows[0], pozo_config: pozoConfig },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (handleUniqueViolation(err, res)) return;
    next(err);
  } finally {
    client.release();
  }
};

/**
 * PATCH /api/companies/sites/:siteId
 * Actualiza informacion basica del sitio o reasigna el serial.
 */
exports.updateSite = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const nextEmpresaId =
      req.body.empresa_id === undefined ? site.empresa_id : normalizeId(req.body.empresa_id);
    const nextSubEmpresaId =
      req.body.sub_empresa_id === undefined
        ? site.sub_empresa_id
        : normalizeId(req.body.sub_empresa_id);

    if (!nextEmpresaId || !nextSubEmpresaId) {
      return badRequest(res, 'empresa_id y sub_empresa_id no pueden quedar vacios.');
    }

    const subCompany = await getSubCompanyById(nextSubEmpresaId);
    if (!subCompany || subCompany.empresa_id !== nextEmpresaId) {
      return notFound(res, 'Subempresa no encontrada para esa empresa.');
    }

    const updates = [];
    const params = [];

    const descripcion = nullableString(req.body.descripcion || req.body.nombre);
    const idSerial = nullableString(req.body.id_serial || req.body.serial_id);
    const ubicacion =
      req.body.ubicacion === undefined ? undefined : nullableString(req.body.ubicacion);
    const tipoSitio =
      req.body.tipo_sitio === undefined ? undefined : normalizeSiteType(req.body.tipo_sitio);
    const activo =
      req.body.activo === undefined ? undefined : parseBoolean(req.body.activo, site.activo);

    if (descripcion) {
      params.push(descripcion);
      updates.push(`descripcion = $${params.length}`);
    }

    if (idSerial) {
      const serialOwner = await ensureSerialAvailable(idSerial, siteId);
      if (serialOwner) {
        return conflict(res, `El serial ${idSerial} ya esta asignado al sitio ${serialOwner.id}.`);
      }

      params.push(idSerial);
      updates.push(`id_serial = $${params.length}`);
    }

    if (ubicacion !== undefined) {
      params.push(ubicacion);
      updates.push(`ubicacion = $${params.length}`);
    }

    if (tipoSitio === null) {
      return badRequest(
        res,
        'tipo_sitio debe ser pozo, vertiente, canal, electrico, riles, camara_frio, proceso o generico.',
      );
    }

    if (tipoSitio) {
      params.push(tipoSitio);
      updates.push(`tipo_sitio = $${params.length}`);
    }

    if (activo !== undefined) {
      params.push(activo);
      updates.push(`activo = $${params.length}`);
    }

    if (nextEmpresaId !== site.empresa_id) {
      params.push(nextEmpresaId);
      updates.push(`empresa_id = $${params.length}`);
    }

    if (nextSubEmpresaId !== site.sub_empresa_id) {
      params.push(nextSubEmpresaId);
      updates.push(`sub_empresa_id = $${params.length}`);
    }

    const nextSiteType = tipoSitio || site.tipo_sitio;
    const shouldUpsertPozoConfig =
      nextSiteType === 'pozo' && (req.body.pozo_config !== undefined || tipoSitio === 'pozo');

    if (!updates.length && !shouldUpsertPozoConfig) {
      return badRequest(res, 'Debe enviar al menos un campo para actualizar.');
    }

    const client = await db.connect();
    let updatedSite = site;
    let pozoConfig = null;

    try {
      await client.query('BEGIN');

      if (updates.length) {
        params.push(siteId);
        const { rows } = await client.query(
          `UPDATE sitio
           SET ${updates.join(', ')}, updated_at = NOW()
           WHERE id = $${params.length}
           RETURNING ${SITE_COLUMNS}, created_at, updated_at`,
          params,
        );
        updatedSite = rows[0];
      }

      if (shouldUpsertPozoConfig) {
        pozoConfig = await upsertPozoConfig(client, siteId, req.body.pozo_config);
      } else {
        pozoConfig = await getPozoConfigBySiteId(siteId);
      }

      if (nextEmpresaId !== site.empresa_id || nextSubEmpresaId !== site.sub_empresa_id) {
        await refreshSubCompanySiteCount(client, site.sub_empresa_id);
        await refreshSubCompanySiteCount(client, nextSubEmpresaId);
        await refreshCompanySiteCount(client, site.empresa_id);
        await refreshCompanySiteCount(client, nextEmpresaId);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({
      ok: true,
      message: 'Sitio actualizado correctamente.',
      data: { ...updatedSite, pozo_config: pozoConfig },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/companies/sites/:siteId
 * Elimina un sitio y refresca los contadores de empresa/subempresa.
 */
exports.deleteSite = async (req, res, next) => {
  const client = await db.connect();

  try {
    const siteId = normalizeId(req.params.siteId);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM reg_map WHERE sitio_id = $1', [siteId]);
    const { rows } = await client.query(
      'DELETE FROM sitio WHERE id = $1 RETURNING id, descripcion',
      [siteId],
    );
    await refreshSubCompanySiteCount(client, site.sub_empresa_id);
    await refreshCompanySiteCount(client, site.empresa_id);
    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Sitio eliminado correctamente.',
      data: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
};

/**
 * GET /api/companies/detected-devices
 * Lista seriales que ya estan reportando en equipo.
 */
exports.getDetectedDevices = async (req, res, next) => {
  try {
    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const limit = parseLimit(req.query.limit, 100);
    const params = [limit];

    const { rows } = await db.query(
      `
      WITH last_row AS (
        SELECT DISTINCT ON (id_serial)
          id_serial,
          time,
          received_at,
          COALESCE(received_at, time) AS ultimo_registro,
          data
        FROM equipo
        WHERE time >= NOW() - INTERVAL '30 days'
        ORDER BY id_serial, time DESC
      )
      SELECT
        lr.id_serial,
        0::int AS total_registros,
        (SELECT COUNT(*)::int FROM jsonb_object_keys(COALESCE(lr.data, '{}'::jsonb))) AS total_datos,
        lr.time AS ultima_medicion_raw,
        lr.received_at AS ultima_llegada_raw,
        lr.ultimo_registro AS ultimo_registro_raw,
        ${utcTimestampSql('lr.time')} AS ultima_medicion,
        ${utcTimestampSql('lr.received_at')} AS ultima_llegada,
        ${utcTimestampSql('lr.ultimo_registro')} AS ultimo_registro,
        CASE
          WHEN lr.received_at IS NULL THEN NULL
          ELSE ROUND(EXTRACT(EPOCH FROM (lr.time - lr.received_at)))::int
        END AS desfase_segundos,
        s.id AS sitio_id,
        s.descripcion AS sitio_descripcion,
        s.tipo_sitio,
        s.activo,
        s.empresa_id,
        e.nombre AS empresa_nombre,
        s.sub_empresa_id,
        se.nombre AS sub_empresa_nombre
      FROM last_row lr
      LEFT JOIN sitio s ON s.id_serial = lr.id_serial
      LEFT JOIN empresa e ON e.id = s.empresa_id
      LEFT JOIN sub_empresa se ON se.id = s.sub_empresa_id
      ORDER BY lr.ultimo_registro DESC
      LIMIT $1
      `,
      params,
    );

    const data = rows.map(
      ({ ultimo_registro_raw, ultima_medicion_raw, ultima_llegada_raw, ...row }) => ({
        ...row,
        total_datos: Number(row.total_datos || 0),
        desfase_segundos:
          row.desfase_segundos === undefined || row.desfase_segundos === null
            ? null
            : Number(row.desfase_segundos),
        ultima_medicion_local: formatChileTimestamp(ultima_medicion_raw),
        ultima_llegada_local: formatChileTimestamp(ultima_llegada_raw),
        ultimo_registro_local: formatChileTimestamp(ultimo_registro_raw),
      }),
    );

    res.json({ ok: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

exports.getSiteTypeCatalog = (_req, res) => {
  res.json({
    ok: true,
    data: getSiteTypeCatalog(),
  });
};

/**
 * GET /api/companies/sites/:siteId/pozo-config
 * Devuelve la fila cruda de pozo_config para el sitio (o null). Usado por
 * formularios admin que necesitan editar obra_dga, profundidades, etc.
 */
exports.getSitePozoConfig = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const site = await getSiteById(siteId);
    if (!site) return notFound(res, 'Sitio no encontrado.');
    if (!canReadSite(req.user, site)) {
      return forbidden(res, 'No tiene permisos para consultar este sitio.');
    }
    const pozoConfig = await getPozoConfigBySiteId(siteId);
    return res.json({ ok: true, data: pozoConfig });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/sites/:siteId/dashboard-data
 * Cruza sitio + pozo_config + reg_map + ultimo registro crudo de equipo.
 * Devuelve valores ya transformados para que el frontend no calcule.
 */
exports.getSiteDashboardData = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    if (!canReadSite(req.user, site)) {
      return forbidden(res, 'No tiene permisos para consultar datos de este sitio.');
    }

    const cacheKey = dashboardDataCacheKey(siteId);
    const cachedData = getCachedDashboardData(cacheKey);
    if (cachedData) {
      return res.json({ ok: true, data: cachedData });
    }

    let dataPromise = dashboardDataInflight.get(cacheKey);
    if (!dataPromise) {
      dataPromise = loadSiteDashboardData(siteId, site).finally(() => {
        dashboardDataInflight.delete(cacheKey);
      });
      dashboardDataInflight.set(cacheKey, dataPromise);
    }

    const data = await dataPromise;
    setCachedDashboardData(cacheKey, data);
    return res.json({ ok: true, data: { ...data, server_time: freshUtcTimestamp() } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/sites/:siteId/dashboard-history
 * Devuelve historico minuto a minuto con variables transformadas para la tabla del pozo.
 */
exports.getSiteDashboardHistory = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const limit = parseLimit(req.query.limit, 50, 500);
    const page = parsePage(req.query.page);
    const offset = (page - 1) * limit;
    const from = parseDateOnly(req.query.from);
    const to = parseDateOnly(req.query.to);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    if (!canReadSite(req.user, site)) {
      return forbidden(res, 'No tiene permisos para consultar datos de este sitio.');
    }

    const useRange = Boolean(from && to);
    let rangeDays = 0;
    if (useRange) {
      rangeDays = countInclusiveDays(from, to);
      if (rangeDays <= 0) {
        return badRequest(res, 'La fecha desde no puede ser mayor que la fecha hasta.');
      }
      if (rangeDays > 93) {
        return badRequest(res, 'El rango maximo es de 3 meses (93 dias).');
      }
    }

    const granularity = dashboardHistoryGranularity();
    const granConfig = HISTORY_EXPORT_GRANULARITY[granularity];

    if (!site.activo) {
      return res.json({
        ok: true,
        count: 0,
        data: {
          site: {
            id: site.id,
            descripcion: site.descripcion,
            id_serial: site.id_serial,
            tipo_sitio: site.tipo_sitio,
            activo: site.activo,
          },
          rows: [],
          pagination: {
            limit,
            page,
            page_size: 50,
            total: 0,
            total_pages: 1,
            has_more: false,
            granularity,
            source: granConfig.view,
          },
          message: 'Sitio inactivo. Se debe mostrar maqueta en frontend.',
        },
      });
    }

    const rangeParams = [site.id_serial, from, to, limit, offset];
    const historyQuery = useRange
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
              last(e.data, e.time)              AS data,
              ${utcTimestampSql('time_bucket($6::interval, e.time)')} AS timestamp_completo
            FROM equipo e
            CROSS JOIN latest_cagg lc
            WHERE e.id_serial = $1
              AND e.time >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
              AND e.time <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
              AND (lc.max_bucket IS NULL OR e.time >= lc.max_bucket + $6::interval)
            GROUP BY 1
          ),
          materialized AS (
            SELECT
              bucket AS time,
              received_at,
              id_serial,
              data,
              ${utcTimestampSql('bucket')} AS timestamp_completo
            FROM ${granConfig.view}
            WHERE id_serial = $1
              AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
              AND bucket <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          )
          SELECT
            time,
            received_at,
            id_serial,
            data,
            timestamp_completo
          FROM (
            SELECT * FROM recent_raw
            UNION ALL
            SELECT * FROM materialized
          ) history
          ORDER BY time DESC
          LIMIT $4
          OFFSET $5
          `,
          [...rangeParams, granConfig.bucketInterval],
        )
      : db.query(
          `
          WITH latest_cagg AS (
            SELECT max(bucket) AS max_bucket
            FROM ${granConfig.view}
            WHERE id_serial = $1
              AND bucket >= now() - INTERVAL '7 days'
          ),
          recent_raw AS (
            SELECT
              time_bucket($4::interval, e.time) AS time,
              last(e.received_at, e.time)       AS received_at,
              last(e.id_serial, e.time)         AS id_serial,
              last(e.data, e.time)              AS data,
              ${utcTimestampSql('time_bucket($4::interval, e.time)')} AS timestamp_completo
            FROM equipo e
            CROSS JOIN latest_cagg lc
            WHERE e.id_serial = $1
              AND e.time >= COALESCE(lc.max_bucket + $4::interval, now() - INTERVAL '2 hours')
            GROUP BY 1
          ),
          materialized AS (
            SELECT
              bucket AS time,
              received_at,
              id_serial,
              data,
              ${utcTimestampSql('bucket')} AS timestamp_completo
            FROM ${granConfig.view}
            WHERE id_serial = $1
              AND bucket >= now() - INTERVAL '7 days'
          )
          SELECT
            time,
            received_at,
            id_serial,
            data,
            timestamp_completo
          FROM (
            SELECT * FROM recent_raw
            UNION ALL
            SELECT * FROM materialized
          ) history
          ORDER BY time DESC
          LIMIT $2
          OFFSET $3
          `,
          [site.id_serial, limit, offset, granConfig.bucketInterval],
        );

    const countQuery = useRange
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
      : db.query(
          `
          WITH latest_cagg AS (
            SELECT max(bucket) AS max_bucket
            FROM ${granConfig.view}
            WHERE id_serial = $1
              AND bucket >= now() - INTERVAL '7 days'
          ),
          recent_raw AS (
            SELECT time_bucket($2::interval, e.time) AS time
            FROM equipo e
            CROSS JOIN latest_cagg lc
            WHERE e.id_serial = $1
              AND e.time >= COALESCE(lc.max_bucket + $2::interval, now() - INTERVAL '2 hours')
            GROUP BY 1
          ),
          materialized AS (
            SELECT bucket AS time
            FROM ${granConfig.view}
            WHERE id_serial = $1
              AND bucket >= now() - INTERVAL '7 days'
          )
          SELECT count(*)::int AS total
          FROM (
            SELECT time FROM recent_raw
            UNION ALL
            SELECT time FROM materialized
          ) history
          `,
          [site.id_serial, granConfig.bucketInterval],
        );

    let [pozoConfigRes, mappingsRes, historyRes, countRes] = await Promise.all([
      db.query(`SELECT ${POZO_CONFIG_COLUMNS} FROM pozo_config WHERE sitio_id = $1`, [siteId]),
      db.query(`SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`, [
        siteId,
      ]),
      historyQuery,
      countQuery,
    ]);

    let historySource = granConfig.view;
    let totalRows = Number(countRes.rows[0]?.total || 0);
    if (useRange && historyRes.rows.length === 0) {
      historyRes = await db.query(
        `
        SELECT
          time_bucket($4::interval, time) AS time,
          last(received_at, time)         AS received_at,
          last(id_serial, time)           AS id_serial,
          last(data, time)                AS data,
          ${utcTimestampSql('time_bucket($4::interval, time)')} AS timestamp_completo
        FROM equipo
        WHERE id_serial = $1
          AND time >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND time <  (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT $5
        OFFSET $6
        `,
        [site.id_serial, from, to, granConfig.bucketInterval, limit, offset],
      );
      historySource = 'equipo';
      totalRows = offset + historyRes.rows.length + (historyRes.rows.length === limit ? 1 : 0);
    } else if (!useRange && historyRes.rows.length === 0) {
      // Equipo sin reportes en últimos 7 días: caemos al cagg sin time bound
      // para devolver los últimos N buckets disponibles. Usa el índice
      // (id_serial, bucket DESC) → barato aunque scanee histórico completo.
      historyRes = await db.query(
        `
        SELECT
          bucket AS time,
          received_at,
          id_serial,
          data,
          ${utcTimestampSql('bucket')} AS timestamp_completo
        FROM ${granConfig.view}
        WHERE id_serial = $1
        ORDER BY bucket DESC
        LIMIT $2
        OFFSET $3
        `,
        [site.id_serial, limit, offset],
      );
      totalRows = offset + historyRes.rows.length + (historyRes.rows.length === limit ? 1 : 0);
    }

    const pozoConfig = pozoConfigRes.rows[0] || null;
    const mappings = mappingsRes.rows || [];
    const rows = historyRes.rows.map((row) =>
      mapHistoricalDashboardRow({ row, site, mappings, pozoConfig }),
    );

    return res.json({
      ok: true,
      count: rows.length,
      data: {
        site: {
          id: site.id,
          descripcion: site.descripcion,
          id_serial: site.id_serial,
          tipo_sitio: site.tipo_sitio,
          activo: site.activo,
        },
        rows,
        pagination: {
          limit,
          page,
          page_size: 50,
          total: totalRows,
          total_pages: Math.max(1, Math.ceil(totalRows / limit)),
          has_more: offset + rows.length < totalRows,
          granularity,
          source: historySource,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/sites/:siteId/dashboard-history/export
 * Exporta historico transformado en CSV, filtrando por sitio y rango local America/Santiago.
 */
exports.exportSiteDashboardHistory = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const site = await getSiteById(siteId);
    const from = parseDateOnly(req.query.from);
    const to = parseDateOnly(req.query.to);
    const format = cleanString(req.query.format || 'csv').toLowerCase();
    const fields = parseHistoryExportFields(req.query.fields);
    const granularity = parseHistoryExportGranularity(req.query.granularity);
    const granConfig = HISTORY_EXPORT_GRANULARITY[granularity];

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    if (!canReadSite(req.user, site)) {
      return forbidden(res, 'No tiene permisos para exportar datos de este sitio.');
    }

    if (format !== 'csv') {
      return badRequest(res, 'Por ahora solo esta disponible la exportacion CSV.');
    }

    if (!from || !to) {
      return badRequest(res, 'Debe indicar un rango valido con from y to en formato YYYY-MM-DD.');
    }

    const days = countInclusiveDays(from, to);
    if (days <= 0) {
      return badRequest(res, 'La fecha desde no puede ser mayor que la fecha hasta.');
    }

    if (days > 366) {
      return badRequest(res, 'El rango maximo de exportacion es de 366 dias.');
    }

    if (!site.activo) {
      return badRequest(res, 'El sitio esta inactivo y no tiene telemetria exportable.');
    }

    const [pozoConfigRes, mappingsRes] = await Promise.all([
      db.query(`SELECT ${POZO_CONFIG_COLUMNS} FROM pozo_config WHERE sitio_id = $1`, [siteId]),
      db.query(`SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`, [
        siteId,
      ]),
    ]);

    const pozoConfig = pozoConfigRes.rows[0] || null;
    const allMappings = mappingsRes.rows || [];
    const exportRoles = new Set(fields);
    const mappings = allMappings.filter((m) => {
      const rol = m.rol_dashboard || 'generico';
      if (exportRoles.has(rol)) return true;
      if (exportRoles.has('nivel_freatico') && m.transformacion === 'nivel_freatico') return true;
      return false;
    });
    const delimiter = ';';
    const header = ['Fecha', ...fields.map((field) => HISTORY_EXPORT_FIELDS[field])];

    const filename = exportFileName(site, from, to, 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Cache-Control', 'no-store');

    const gz = zlib.createGzip({ level: 1 });
    gz.pipe(res);

    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      await client.query(
        `
        DECLARE history_export_cursor NO SCROLL CURSOR FOR
        SELECT
          bucket AS time,
          received_at,
          id_serial,
          data,
          ${utcTimestampSql('bucket')} AS timestamp_completo
        FROM ${granConfig.view}
        WHERE id_serial = $1
          AND bucket >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          AND bucket < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
        ORDER BY bucket ASC
        `,
        [site.id_serial, from, to],
      );

      await writeResponseChunk(gz, '\uFEFF');
      await writeResponseChunk(
        gz,
        `${header.map((value) => csvCell(value, delimiter)).join(delimiter)}\n`,
      );

      while (true) {
        const batch = await client.query('FETCH 50000 FROM history_export_cursor');
        if (batch.rows.length === 0) break;

        const lines = batch.rows.map((rawRow) => {
          const row = mapHistoricalDashboardRow({ row: rawRow, site, mappings, pozoConfig });
          const fecha = row.timestamp
            ? formatChileTimestamp(row.timestamp) || row.fecha
            : row.fecha;
          return [fecha, ...fields.map((field) => csvValue(row[field]))]
            .map((value) => csvCell(value, delimiter))
            .join(delimiter);
        });
        await writeResponseChunk(gz, lines.join('\n') + '\n');
      }

      await client.query('CLOSE history_export_cursor');
      await client.query('COMMIT');
      return new Promise((resolve, reject) => {
        gz.on('finish', resolve);
        gz.on('error', reject);
        gz.end();
      });
    } catch (streamErr) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackErr) {}
      }

      if (!res.headersSent) {
        throw streamErr;
      }

      gz.destroy(streamErr);
      return res.destroy(streamErr);
    } finally {
      if (client) client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/sites/:siteId/variables
 * Devuelve variables detectadas del serial y los alias guardados en reg_map.
 */
exports.getSiteVariables = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const mappingsRes = await db.query(
      `SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`,
      [siteId],
    );

    const detectedRes = await db.query(
      `
      SELECT
        kv.key  AS nombre_dato,
        kv.value AS valor_dato,
        ${utcTimestampSql('lr.time')} AS timestamp_completo
      FROM (
        SELECT time, data
        FROM equipo
        WHERE id_serial = $1
        ORDER BY time DESC
        LIMIT 1
      ) lr
      CROSS JOIN LATERAL jsonb_each(lr.data) AS kv(key, value)
      ORDER BY kv.key ASC
      `,
      [site.id_serial],
    );

    const mappingsByKey = new Map(mappingsRes.rows.map((mapping) => [mapping.d1, mapping]));
    const variables = detectedRes.rows.map((variable) => ({
      ...variable,
      mapping: mappingsByKey.get(variable.nombre_dato) || null,
    }));
    const pozoConfig = site.tipo_sitio === 'pozo' ? await getPozoConfigBySiteId(siteId) : null;

    res.json({
      ok: true,
      data: {
        site,
        pozo_config: pozoConfig,
        variables,
        mappings: mappingsRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/companies/sites/:siteId/variables
 * Crea un alias/mapeo para una variable detectada.
 */
exports.createSiteVariableMap = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const alias = cleanString(req.body.alias);
    const d1 = cleanString(req.body.d1 || req.body.nombre_dato);
    const d2 = nullableString(req.body.d2);
    const tipoDato = cleanString(req.body.tipo_dato) || 'FLOAT';
    const unidad = nullableString(req.body.unidad);
    const rolDashboard = normalizeVariableRole(req.body.rol_dashboard);
    const transformacion = normalizeVariableTransform(req.body.transformacion);
    const parametros = parseJsonObject(req.body.parametros);

    if (!alias || !d1) {
      return badRequest(res, 'alias y d1 son requeridos.');
    }
    if (!rolDashboard) {
      return badRequest(res, 'rol_dashboard no es valido.');
    }
    if (!transformacion) {
      return badRequest(res, 'transformacion no es valida.');
    }
    if (parametros === null) {
      return badRequest(res, 'parametros debe ser un objeto JSON valido.');
    }
    if (['ieee754_32', 'uint32_registros'].includes(transformacion) && !d2) {
      return badRequest(res, 'd2 es requerido para esta transformacion.');
    }

    const existing = await db.query(
      'SELECT id FROM reg_map WHERE sitio_id = $1 AND d1 = $2 LIMIT 1',
      [siteId, d1],
    );

    if (existing.rows.length) {
      return conflict(res, `La variable ${d1} ya tiene un mapeo para este sitio.`);
    }

    const requestedId = cleanString(req.body.id);
    const id = requestedId || generateMapId();

    const { rows } = await db.query(
      `INSERT INTO reg_map (id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING ${MAP_COLUMNS}`,
      [
        id,
        alias,
        d1,
        d2,
        tipoDato,
        unidad,
        rolDashboard,
        transformacion,
        JSON.stringify(parametros),
        siteId,
      ],
    );

    res.status(201).json({
      ok: true,
      message: 'Variable mapeada correctamente.',
      data: rows[0],
    });
  } catch (err) {
    if (handleUniqueViolation(err, res)) return;
    next(err);
  }
};

/**
 * PATCH /api/companies/sites/:siteId/variables/:mapId
 */
exports.updateSiteVariableMap = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const mapId = cleanString(req.params.mapId);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const currentMap = await db.query(
      `SELECT ${MAP_COLUMNS} FROM reg_map WHERE id = $1 AND sitio_id = $2`,
      [mapId, siteId],
    );

    if (!currentMap.rows.length) {
      return notFound(res, 'Mapeo no encontrado para este sitio.');
    }

    const current = currentMap.rows[0];
    const rolDashboard =
      req.body.rol_dashboard === undefined
        ? undefined
        : normalizeVariableRole(req.body.rol_dashboard);
    const transformacion =
      req.body.transformacion === undefined
        ? undefined
        : normalizeVariableTransform(req.body.transformacion);
    const parametros =
      req.body.parametros === undefined ? undefined : parseJsonObject(req.body.parametros);

    if (req.body.rol_dashboard !== undefined && !rolDashboard) {
      return badRequest(res, 'rol_dashboard no es valido.');
    }
    if (req.body.transformacion !== undefined && !transformacion) {
      return badRequest(res, 'transformacion no es valida.');
    }
    if (parametros === null) {
      return badRequest(res, 'parametros debe ser un objeto JSON valido.');
    }

    const nextD2 = req.body.d2 === undefined ? current.d2 : nullableString(req.body.d2);
    const nextTransform = transformacion || current.transformacion || 'directo';
    if (['ieee754_32', 'uint32_registros'].includes(nextTransform) && !nextD2) {
      return badRequest(res, 'd2 es requerido para esta transformacion.');
    }

    const updates = [];
    const params = [];
    const fields = [
      ['alias', req.body.alias === undefined ? undefined : cleanString(req.body.alias)],
      [
        'd1',
        req.body.d1 === undefined && req.body.nombre_dato === undefined
          ? undefined
          : cleanString(req.body.d1 || req.body.nombre_dato),
      ],
      ['d2', req.body.d2 === undefined ? undefined : nullableString(req.body.d2)],
      ['tipo_dato', req.body.tipo_dato === undefined ? undefined : cleanString(req.body.tipo_dato)],
      ['unidad', req.body.unidad === undefined ? undefined : nullableString(req.body.unidad)],
      ['rol_dashboard', rolDashboard],
      ['transformacion', transformacion],
    ];

    for (const [field, value] of fields) {
      if (value === undefined) continue;
      if (value === '' && field !== 'd2' && field !== 'unidad') continue;
      params.push(value);
      updates.push(`${field} = $${params.length}`);
    }

    if (parametros !== undefined) {
      params.push(JSON.stringify(parametros));
      updates.push(`parametros = $${params.length}::jsonb`);
    }

    if (!updates.length) {
      return badRequest(res, 'Debe enviar al menos un campo para actualizar.');
    }

    params.push(mapId, siteId);
    const { rows } = await db.query(
      `UPDATE reg_map
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND sitio_id = $${params.length}
       RETURNING ${MAP_COLUMNS}`,
      params,
    );

    res.json({
      ok: true,
      message: 'Mapeo actualizado correctamente.',
      data: rows[0],
    });
  } catch (err) {
    if (handleUniqueViolation(err, res)) return;
    next(err);
  }
};

/**
 * DELETE /api/companies/sites/:siteId/variables/:mapId
 */
exports.deleteSiteVariableMap = async (req, res, next) => {
  try {
    const siteId = normalizeId(req.params.siteId);
    const mapId = cleanString(req.params.mapId);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    const superAdminError = requireSuperAdmin(req, res);
    if (superAdminError) {
      return superAdminError;
    }

    const { rowCount } = await db.query('DELETE FROM reg_map WHERE id = $1 AND sitio_id = $2', [
      mapId,
      siteId,
    ]);

    if (!rowCount) {
      return notFound(res, 'Mapeo no encontrado para este sitio.');
    }

    res.json({ ok: true, message: 'Mapeo eliminado correctamente.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/contacts
 * Lista la agenda operacional del alcance visible para el usuario.
 */
exports.listOperationalContacts = async (req, res, next) => {
  try {
    const { tipo, empresa_id: userEmpresaId, sub_empresa_id: userSubEmpresaId } = req.user;
    const queryEmpresaId = normalizeId(req.query.empresa_id || '');
    const querySubEmpresaId = normalizeId(req.query.sub_empresa_id || '');

    const conditions = [];
    const params = [];

    if (tipo === 'SuperAdmin') {
      if (queryEmpresaId) {
        params.push(queryEmpresaId);
        conditions.push(`co.empresa_id = $${params.length}`);
      }
      if (querySubEmpresaId) {
        params.push(querySubEmpresaId);
        conditions.push(`co.sub_empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Admin') {
      params.push(userEmpresaId);
      conditions.push(`co.empresa_id = $${params.length}`);
      if (querySubEmpresaId) {
        params.push(querySubEmpresaId);
        conditions.push(`co.sub_empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Gerente' || tipo === 'Cliente') {
      if (!userEmpresaId || !userSubEmpresaId) {
        return res.json({ ok: true, data: [] });
      }
      params.push(userEmpresaId);
      conditions.push(`co.empresa_id = $${params.length}`);
      params.push(userSubEmpresaId);
      conditions.push(`co.sub_empresa_id = $${params.length}`);
    } else {
      return forbidden(res, 'No tiene permisos para ver contactos.');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT ${CONTACT_COLUMNS}
         FROM contacto_operativo co
         LEFT JOIN usuario u ON u.id = co.usuario_id
         LEFT JOIN empresa e ON e.id = co.empresa_id
         LEFT JOIN sub_empresa se ON se.id = co.sub_empresa_id
         LEFT JOIN sitio s ON s.id = co.sitio_id
        ${where}
        ORDER BY co.tipo_contacto ASC, co.nombre ASC`,
      params,
    );

    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/companies/contacts
 * Crea un contacto operativo. Puede vincular usuario existente o ser externo.
 */
exports.createOperationalContact = async (req, res, next) => {
  try {
    const empresaId = normalizeId(req.body.empresa_id);
    const subEmpresaId = normalizeId(req.body.sub_empresa_id);
    const sitioId = req.body.sitio_id ? normalizeId(req.body.sitio_id) : null;
    const usuarioId = req.body.usuario_id ? normalizeId(req.body.usuario_id) : null;
    const nombre = cleanString(req.body.nombre);
    const apellido = cleanString(req.body.apellido);
    const email = nullableString(req.body.email);
    const telefono = nullableString(req.body.telefono);
    const cargo = cleanString(req.body.cargo);
    const tipoContacto = cleanString(req.body.tipo_contacto) || 'Operacion';
    const notas = nullableString(req.body.notas);

    if (!empresaId || !subEmpresaId) {
      return badRequest(res, 'empresa_id y sub_empresa_id son requeridos.');
    }
    if (!nombre || !apellido || !cargo || !tipoContacto) {
      return badRequest(res, 'nombre, apellido, cargo y tipo_contacto son requeridos.');
    }
    if (nombre.length > 12 || apellido.length > 12) {
      return badRequest(res, 'nombre y apellido deben tener maximo 12 caracteres.');
    }
    if ((email && email.length > 35) || cargo.length > 35) {
      return badRequest(res, 'correo y cargo deben tener maximo 35 caracteres.');
    }
    if (!email && !telefono) {
      return badRequest(res, 'Debe indicar telefono o correo del contacto.');
    }
    if (telefono && !/^\+56\s?\d{9}$/.test(telefono)) {
      return badRequest(res, 'El telefono debe usar formato +56 y 9 digitos.');
    }
    if (
      !canMutateOperationalContacts(req.user, {
        empresa_id: empresaId,
        sub_empresa_id: subEmpresaId,
      })
    ) {
      return forbidden(res, 'No tiene permisos para crear contactos en este alcance.');
    }

    const { rows: subRows } = await db.query(
      'SELECT id FROM sub_empresa WHERE id = $1 AND empresa_id = $2',
      [subEmpresaId, empresaId],
    );
    if (!subRows.length) {
      return badRequest(res, 'La division no pertenece a la empresa indicada.');
    }

    if (sitioId) {
      const { rows: siteRows } = await db.query(
        'SELECT id FROM sitio WHERE id = $1 AND empresa_id = $2 AND sub_empresa_id = $3',
        [sitioId, empresaId, subEmpresaId],
      );
      if (!siteRows.length) {
        return badRequest(res, 'El sitio no pertenece a la division indicada.');
      }
    }

    if (usuarioId) {
      const { rows: userRows } = await db.query(
        `SELECT id FROM usuario
          WHERE id = $1
            AND empresa_id = $2
            AND (sub_empresa_id = $3 OR sub_empresa_id IS NULL)`,
        [usuarioId, empresaId, subEmpresaId],
      );
      if (!userRows.length) {
        return badRequest(res, 'El usuario vinculado no pertenece a este alcance.');
      }
    }

    const { rows } = await db.query(
      `INSERT INTO contacto_operativo (
         empresa_id, sub_empresa_id, sitio_id, usuario_id, nombre, apellido, email,
         telefono, cargo, tipo_contacto, notas, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id::text`,
      [
        empresaId,
        subEmpresaId,
        sitioId,
        usuarioId,
        nombre,
        apellido,
        email,
        telefono,
        cargo,
        tipoContacto,
        notas,
        req.user?.id || null,
      ],
    );

    const created = await db.query(
      `SELECT ${CONTACT_COLUMNS}
         FROM contacto_operativo co
         LEFT JOIN usuario u ON u.id = co.usuario_id
         LEFT JOIN empresa e ON e.id = co.empresa_id
         LEFT JOIN sub_empresa se ON se.id = co.sub_empresa_id
         LEFT JOIN sitio s ON s.id = co.sitio_id
        WHERE co.id = $1`,
      [rows[0].id],
    );

    res.status(201).json({ ok: true, data: created.rows[0] });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/companies/contacts/:contactId
 */
exports.deleteOperationalContact = async (req, res, next) => {
  try {
    const contactId = cleanString(req.params.contactId);
    const { rows } = await db.query(
      'SELECT id, empresa_id, sub_empresa_id FROM contacto_operativo WHERE id = $1',
      [contactId],
    );
    const contact = rows[0];
    if (!contact) {
      return notFound(res, 'Contacto no encontrado.');
    }

    if (!canMutateOperationalContacts(req.user, contact)) {
      return forbidden(res, 'No tiene permisos para eliminar este contacto.');
    }

    await db.query('DELETE FROM contacto_operativo WHERE id = $1', [contactId]);
    res.json({ ok: true, message: 'Contacto eliminado correctamente.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/:id/sites
 *
 * El id puede ser una sub_empresa o una empresa:
 * - Si es sub_empresa, devuelve solo sus sitios.
 * - Si es empresa, devuelve sus sitios respetando el alcance del usuario.
 */
exports.getCompanySites = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tipo, empresa_id, sub_empresa_id } = req.user;

    const subCompanyRes = await db.query('SELECT id, empresa_id FROM sub_empresa WHERE id = $1', [
      id,
    ]);
    const subCompany = subCompanyRes.rows[0];

    if (subCompany) {
      if (tipo !== 'SuperAdmin' && subCompany.empresa_id !== empresa_id) {
        return res.status(403).json({ ok: false, error: 'No tiene acceso a esta sub-empresa' });
      }

      if ((tipo === 'Gerente' || tipo === 'Cliente') && sub_empresa_id && id !== sub_empresa_id) {
        return res.status(403).json({ ok: false, error: 'No tiene acceso a esta sub-empresa' });
      }

      const { rows } = await db.query(
        `SELECT ${SITE_COLUMNS} FROM sitio WHERE sub_empresa_id = $1 ORDER BY descripcion ASC`,
        [id],
      );
      return res.json({ ok: true, data: await attachPozoConfigsToSites(rows) });
    }

    if (tipo !== 'SuperAdmin' && id !== empresa_id) {
      return res.status(403).json({ ok: false, error: 'No tiene acceso a esta empresa' });
    }

    const params = [];
    let query = `SELECT ${SITE_COLUMNS} FROM sitio`;

    if ((tipo === 'Gerente' || tipo === 'Cliente') && sub_empresa_id) {
      params.push(sub_empresa_id);
      query += ` WHERE sub_empresa_id = $${params.length}`;
    } else {
      params.push(id);
      query += ` WHERE empresa_id = $${params.length}`;
    }

    query += ' ORDER BY descripcion ASC';

    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: await attachPozoConfigsToSites(rows) });
  } catch (err) {
    next(err);
  }
};
