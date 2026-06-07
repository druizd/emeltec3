const {
  PASTEURIZADOR_SITE_TYPE,
  PASTEURIZADOR_DEFAULT_HISTORY_ROLES,
  PASTEURIZADOR_HISTORY_GRANULARITY,
  PASTEURIZADOR_ROLE_IDS,
  getSiteById,
  loadPasteurizadorBundle,
  loadPasteurizadorDailyKpis,
  loadPasteurizadorHistory,
  loadPasteurizadorSnapshot,
  loadPasteurizadorSummary,
  normalizePasteurizadorRoles,
} = require('../services/pasteurizadorTelemetryService');
const { formatChileTimestamp } = require('../utils/timezone');

function cleanString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeId(value) {
  return cleanString(value).toUpperCase();
}

function badRequest(res, message) {
  return res.status(400).json({ ok: false, error: message, message });
}

function forbidden(res, message = 'No tiene permisos para consultar este recurso.') {
  return res.status(403).json({ ok: false, error: message, message });
}

function notFound(res, message) {
  return res.status(404).json({ ok: false, error: message, message });
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

function parseLimit(value, fallback = 500, max = 2500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
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

function parseGranularity(value, fallback = '1m') {
  const key = cleanString(value || fallback).toLowerCase();
  return PASTEURIZADOR_HISTORY_GRANULARITY[key] ? key : null;
}

function queryValue(query, primary, secondary) {
  return query[primary] ?? (secondary ? query[secondary] : undefined);
}

function chileTodayDate() {
  return formatChileTimestamp(new Date())?.slice(0, 10) || new Date().toISOString().slice(0, 10);
}

async function loadAuthorizedPasteurizador(req, res) {
  const siteId = normalizeId(req.params.siteId);
  if (!siteId) {
    badRequest(res, 'siteId requerido.');
    return null;
  }

  const site = await getSiteById(siteId);
  if (!site) {
    notFound(res, 'Sitio no encontrado.');
    return null;
  }

  if (!canReadSite(req.user, site)) {
    forbidden(res, 'No tiene permisos para consultar este sitio.');
    return null;
  }

  if (site.tipo_sitio !== PASTEURIZADOR_SITE_TYPE) {
    badRequest(res, 'El sitio solicitado no es de tipo pasteurizador.');
    return null;
  }

  return site;
}

function parseRoleSelection(req, res, fallback = PASTEURIZADOR_DEFAULT_HISTORY_ROLES) {
  const parsed = normalizePasteurizadorRoles(req.query.roles, fallback);
  if (!parsed.ok) {
    badRequest(res, parsed.error);
    return null;
  }
  return parsed.roles;
}

function parseOptionalRange(req, res, granularity) {
  const fromRaw = queryValue(req.query, 'from', 'desde');
  const toRaw = queryValue(req.query, 'to', 'hasta');

  if (!fromRaw && !toRaw) return { ok: true, from: null, to: null };
  const from = parseDateOnly(fromRaw);
  const to = parseDateOnly(toRaw);
  if (!from || !to) {
    badRequest(res, 'from/to deben usar formato YYYY-MM-DD.');
    return { ok: false };
  }

  const days = countInclusiveDays(from, to);
  if (days <= 0) {
    badRequest(res, 'La fecha desde no puede ser mayor que hasta.');
    return { ok: false };
  }

  const maxDays = PASTEURIZADOR_HISTORY_GRANULARITY[granularity].maxDays;
  if (days > maxDays) {
    badRequest(res, `Rango maximo para granularidad ${granularity}: ${maxDays} dias.`);
    return { ok: false };
  }

  return { ok: true, from, to };
}

function parseRequiredRange(req, res, granularity) {
  const parsed = parseOptionalRange(req, res, granularity);
  if (!parsed.ok) return parsed;
  if (!parsed.from || !parsed.to) {
    badRequest(res, 'from/to son requeridos para el resumen.');
    return { ok: false };
  }
  return parsed;
}

exports.getPasteurizadorSnapshot = async (req, res, next) => {
  try {
    const site = await loadAuthorizedPasteurizador(req, res);
    if (!site) return;

    const data = await loadPasteurizadorSnapshot(site);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getPasteurizadorBundle = async (req, res, next) => {
  const t0 = process.hrtime.bigint();
  const ms = (since) => Number(process.hrtime.bigint() - since) / 1e6;

  try {
    const site = await loadAuthorizedPasteurizador(req, res);
    if (!site) return;

    const granularity = parseGranularity(req.query.granularity, '1m');
    if (!granularity) {
      return badRequest(res, 'granularity debe ser 1m, 5m, 1h o 1d.');
    }

    const roles = parseRoleSelection(req, res);
    if (!roles) return;

    const data = await loadPasteurizadorBundle(site, {
      limit: parseLimit(req.query.limit, 500, 3500),
      granularity,
      roles,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Server-Timing', `total;dur=${ms(t0).toFixed(1)}`);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getPasteurizadorHistory = async (req, res, next) => {
  try {
    const site = await loadAuthorizedPasteurizador(req, res);
    if (!site) return;

    const granularity = parseGranularity(req.query.granularity, '1m');
    if (!granularity) {
      return badRequest(res, 'granularity debe ser 1m, 5m, 1h o 1d.');
    }

    const roles = parseRoleSelection(req, res);
    if (!roles) return;

    const range = parseOptionalRange(req, res, granularity);
    if (!range.ok) return;

    const data = await loadPasteurizadorHistory(site, {
      from: range.from,
      to: range.to,
      limit: parseLimit(req.query.limit, 500, 2500),
      page: parsePage(req.query.page),
      granularity,
      roles,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, count: data.rows.length, data });
  } catch (err) {
    next(err);
  }
};

exports.getPasteurizadorDailyKpis = async (req, res, next) => {
  try {
    const site = await loadAuthorizedPasteurizador(req, res);
    if (!site) return;

    const date = parseDateOnly(req.query.date || req.query.fecha || chileTodayDate());
    if (!date) {
      return badRequest(res, 'date debe usar formato YYYY-MM-DD.');
    }

    const data = await loadPasteurizadorDailyKpis(site, { date });

    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getPasteurizadorSummary = async (req, res, next) => {
  try {
    const site = await loadAuthorizedPasteurizador(req, res);
    if (!site) return;

    const granularity = parseGranularity(req.query.granularity, '5m');
    if (!granularity) {
      return badRequest(res, 'granularity debe ser 1m, 5m, 1h o 1d.');
    }

    const roles = parseRoleSelection(req, res, PASTEURIZADOR_ROLE_IDS);
    if (!roles) return;

    const range = parseRequiredRange(req, res, granularity);
    if (!range.ok) return;

    const data = await loadPasteurizadorSummary(site, {
      from: range.from,
      to: range.to,
      granularity,
      roles,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
