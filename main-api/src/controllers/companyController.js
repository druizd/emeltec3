const crypto = require('crypto');
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

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, tipo_sitio, activo';
const MAP_COLUMNS =
  'id, alias, d1, d2, tipo_dato, unidad, rol_dashboard, transformacion, parametros, sitio_id, created_at, updated_at';
const POZO_CONFIG_COLUMNS =
  'sitio_id, profundidad_pozo_m, profundidad_sensor_m, nivel_estatico_manual_m, obra_dga, slug, created_at, updated_at';
const SITE_TYPES = new Set(SITE_TYPE_IDS);
const VARIABLE_ROLES = new Set(VARIABLE_ROLE_IDS);
const VARIABLE_TRANSFORMS = new Set(VARIABLE_TRANSFORM_IDS);

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
    `SELECT ${POZO_CONFIG_COLUMNS} FROM pozo_config WHERE sitio_id = $1`,
    [siteId],
  );
  return rows[0] || null;
}

async function attachPozoConfigsToSites(sites) {
  if (!sites.length) return sites;

  const siteIds = sites.map((site) => site.id);
  const { rows } = await db.query(
    `SELECT ${POZO_CONFIG_COLUMNS} FROM pozo_config WHERE sitio_id = ANY($1::text[])`,
    [siteIds],
  );
  const configsBySiteId = new Map(rows.map((row) => [row.sitio_id, row]));

  return sites.map((site) => ({
    ...site,
    pozo_config: configsBySiteId.get(site.id) || null,
  }));
}

function parsePozoConfig(rawConfig = {}) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  return {
    profundidad_pozo_m: parseOptionalNumber(source.profundidad_pozo_m),
    profundidad_sensor_m: parseOptionalNumber(source.profundidad_sensor_m),
    nivel_estatico_manual_m: parseOptionalNumber(source.nivel_estatico_manual_m),
    obra_dga: nullableString(source.obra_dga),
    slug: nullableString(source.slug),
  };
}

async function upsertPozoConfig(client, siteId, rawConfig = {}) {
  const config = parsePozoConfig(rawConfig);

  const { rows } = await client.query(
    `INSERT INTO pozo_config
       (sitio_id, profundidad_pozo_m, profundidad_sensor_m, nivel_estatico_manual_m, obra_dga, slug)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sitio_id) DO UPDATE SET
       profundidad_pozo_m = EXCLUDED.profundidad_pozo_m,
       profundidad_sensor_m = EXCLUDED.profundidad_sensor_m,
       nivel_estatico_manual_m = EXCLUDED.nivel_estatico_manual_m,
       obra_dga = EXCLUDED.obra_dga,
       slug = EXCLUDED.slug,
       updated_at = NOW()
     RETURNING ${POZO_CONFIG_COLUMNS}`,
    [
      siteId,
      config.profundidad_pozo_m,
      config.profundidad_sensor_m,
      config.nivel_estatico_manual_m,
      config.obra_dga,
      config.slug,
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
    const rut = cleanString(req.body.rut);
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
      ['rut', req.body.rut === undefined ? undefined : cleanString(req.body.rut)],
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
    const rut = cleanString(req.body.rut);

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
      ['rut', req.body.rut === undefined ? undefined : cleanString(req.body.rut)],
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
        'tipo_sitio debe ser pozo, electrico, riles, camara_frio, proceso o generico.',
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
        'tipo_sitio debe ser pozo, electrico, riles, camara_frio, proceso o generico.',
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

    const shouldUpsertPozoConfig =
      req.body.pozo_config !== undefined && (tipoSitio || site.tipo_sitio) === 'pozo';

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
      WITH latest AS (
        SELECT
          id_serial,
          COUNT(*)::int AS total_registros,
          MAX(COALESCE(received_at, time)) AS ultimo_registro
        FROM equipo
        GROUP BY id_serial
        ORDER BY MAX(COALESCE(received_at, time)) DESC
        LIMIT $1
      ),
      detected_keys AS (
        SELECT e.id_serial, COUNT(DISTINCT kv.key)::int AS total_datos
        FROM equipo e
        JOIN latest l ON l.id_serial = e.id_serial
        CROSS JOIN LATERAL jsonb_each(COALESCE(e.data, '{}'::jsonb)) AS kv(key, value)
        GROUP BY e.id_serial
      )
      SELECT
        l.id_serial,
        l.total_registros,
        COALESCE(dk.total_datos, 0)::int AS total_datos,
        l.ultimo_registro AS ultimo_registro_raw,
        ${utcTimestampSql('l.ultimo_registro')} AS ultimo_registro,
        s.id AS sitio_id,
        s.descripcion AS sitio_descripcion,
        s.tipo_sitio,
        s.activo,
        s.empresa_id,
        e.nombre AS empresa_nombre,
        s.sub_empresa_id,
        se.nombre AS sub_empresa_nombre
      FROM latest l
      LEFT JOIN detected_keys dk ON dk.id_serial = l.id_serial
      LEFT JOIN sitio s ON s.id_serial = l.id_serial
      LEFT JOIN empresa e ON e.id = s.empresa_id
      LEFT JOIN sub_empresa se ON se.id = s.sub_empresa_id
      ORDER BY l.ultimo_registro DESC
      `,
      params,
    );

    const data = rows.map(({ ultimo_registro_raw, ...row }) => ({
      ...row,
      total_datos: Number(row.total_datos || 0),
      ultimo_registro_local: formatChileTimestamp(ultimo_registro_raw),
    }));

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

    const [pozoConfigRes, mappingsRes, latestRes] = await Promise.all([
      db.query(`SELECT ${POZO_CONFIG_COLUMNS} FROM pozo_config WHERE sitio_id = $1`, [siteId]),
      db.query(`SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`, [
        siteId,
      ]),
      db.query(
        `
        SELECT
          time,
          received_at,
          id_serial,
          data,
          ${utcTimestampSql('time')} AS timestamp_completo
        FROM equipo
        WHERE id_serial = $1
        ORDER BY time DESC
        LIMIT 1
        `,
        [site.id_serial],
      ),
    ]);

    const pozoConfig = pozoConfigRes.rows[0] || null;
    const latest = latestRes.rows[0] || null;

    return res.json({
      ok: true,
      data: buildSiteDashboardData({
        site,
        pozoConfig,
        mappings: mappingsRes.rows,
        latest,
      }),
    });
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
    const limit = parseLimit(req.query.limit, 500, 2500);
    const site = await getSiteById(siteId);

    if (!site) {
      return notFound(res, 'Sitio no encontrado.');
    }

    if (!canReadSite(req.user, site)) {
      return forbidden(res, 'No tiene permisos para consultar datos de este sitio.');
    }

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
            page_size: 50,
          },
          message: 'Sitio inactivo. Se debe mostrar maqueta en frontend.',
        },
      });
    }

    const [pozoConfigRes, mappingsRes, historyRes] = await Promise.all([
      db.query(`SELECT ${POZO_CONFIG_COLUMNS} FROM pozo_config WHERE sitio_id = $1`, [siteId]),
      db.query(`SELECT ${MAP_COLUMNS} FROM reg_map WHERE sitio_id = $1 ORDER BY alias ASC`, [
        siteId,
      ]),
      db.query(
        `
        SELECT time, received_at, id_serial, data, timestamp_completo
        FROM (
          SELECT DISTINCT ON (date_trunc('minute', time))
            time,
            received_at,
            id_serial,
            data,
            ${utcTimestampSql('time')} AS timestamp_completo
          FROM equipo
          WHERE id_serial = $1
          ORDER BY date_trunc('minute', time) DESC, time DESC
        ) latest_by_minute
        ORDER BY time DESC
        LIMIT $2
        `,
        [site.id_serial, limit],
      ),
    ]);

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
          page_size: 50,
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
    const mappings = mappingsRes.rows || [];
    const delimiter = ';';
    const header = ['Fecha', ...fields.map((field) => HISTORY_EXPORT_FIELDS[field])];

    const filename = exportFileName(site, from, to, 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      await client.query(
        `
        DECLARE history_export_cursor NO SCROLL CURSOR FOR
        SELECT time, received_at, id_serial, data, timestamp_completo
        FROM (
          SELECT DISTINCT ON (date_trunc('minute', time))
            time,
            received_at,
            id_serial,
            data,
            ${utcTimestampSql('time')} AS timestamp_completo
          FROM equipo
          WHERE id_serial = $1
            AND time >= ($2::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
            AND time < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
          ORDER BY date_trunc('minute', time) ASC, time DESC
        ) latest_by_minute
        ORDER BY time ASC
        `,
        [site.id_serial, from, to],
      );

      await writeResponseChunk(res, '\uFEFF');
      await writeResponseChunk(
        res,
        `${header.map((value) => csvCell(value, delimiter)).join(delimiter)}\n`,
      );

      while (true) {
        const batch = await client.query('FETCH 1000 FROM history_export_cursor');
        if (batch.rows.length === 0) break;

        for (const rawRow of batch.rows) {
          const row = mapHistoricalDashboardRow({ row: rawRow, site, mappings, pozoConfig });
          const fecha = row.timestamp
            ? formatChileTimestamp(row.timestamp) || row.fecha
            : row.fecha;
          const line = [fecha, ...fields.map((field) => csvValue(row[field]))]
            .map((value) => csvCell(value, delimiter))
            .join(delimiter);
          await writeResponseChunk(res, `${line}\n`);
        }
      }

      await client.query('CLOSE history_export_cursor');
      await client.query('COMMIT');
      return res.end();
    } catch (streamErr) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (_rollbackErr) {}
      }

      if (!res.headersSent) {
        throw streamErr;
      }

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
        latest.nombre_dato,
        latest.valor_dato,
        ${utcTimestampSql('latest.time')} AS timestamp_completo
      FROM (
        SELECT DISTINCT ON (kv.key)
          kv.key AS nombre_dato,
          kv.value AS valor_dato,
          lr.time
        FROM equipo lr
        CROSS JOIN LATERAL jsonb_each(lr.data) AS kv(key, value)
        WHERE lr.id_serial = $1
        ORDER BY kv.key, lr.time DESC
      ) latest
      ORDER BY latest.nombre_dato ASC
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
