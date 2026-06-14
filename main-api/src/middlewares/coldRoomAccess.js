const pool = require('../config/db');
const { canAccessSite, findUnauthorizedSites } = require('../services/dataAccess');

/**
 * Cache simple en memoria para sitios → empresa_id/sub_empresa_id.
 * Sitios cambian raramente; TTL 5 min evita query repetida por request.
 */
const siteCache = new Map(); // siteId → { empresa_id, sub_empresa_id, exp }
const CACHE_TTL = 5 * 60_000;

async function lookupSite(siteId) {
  const now = Date.now();
  const cached = siteCache.get(siteId);
  if (cached && cached.exp > now) return cached;
  const { rows } = await pool.query(`SELECT empresa_id, sub_empresa_id FROM sitio WHERE id = $1`, [
    siteId,
  ]);
  if (rows.length === 0) return null;
  const entry = { ...rows[0], exp: now + CACHE_TTL };
  siteCache.set(siteId, entry);
  return entry;
}

/**
 * Verifica que el req.user tenga acceso al sitio identificado por req.params[paramName].
 * Modelo ESTRICTO (decisión jun-2026, ver dataAccess.canAccessSite):
 * - SuperAdmin: bypass total.
 * - Admin: empresa_id del user debe coincidir con empresa_id del sitio.
 * - Gerente/Cliente: empresa_id Y sub_empresa_id deben coincidir.
 */
function requireSiteAccess(paramName = 'siteId') {
  return async (req, res, next) => {
    try {
      const siteId = req.params[paramName];
      if (!siteId) return res.status(400).json({ ok: false, error: 'siteId requerido' });
      const u = req.user;
      if (!u) return res.status(401).json({ ok: false, error: 'No autenticado' });
      if (u.tipo === 'SuperAdmin') return next();

      const site = await lookupSite(siteId);
      if (!site) return res.status(404).json({ ok: false, error: 'Sitio no encontrado' });

      if (canAccessSite(u, site)) return next();
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
    } catch (err) {
      console.error('[coldRoomAccess] error:', err.message);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  };
}

/**
 * Valida que TODOS los siteIds de una query (p. ej. ?siteIds=S1,S2) pertenezcan
 * al alcance del usuario. Devuelve la lista de denegados (vacía = todo OK).
 * Cierra el bypass EMT-C02 donde requireSiteAccess solo validaba el :siteId
 * de la ruta y los handlers consultaban la lista de query sin validar.
 */
async function findUnauthorizedSiteIds(user, siteIds) {
  return findUnauthorizedSites(siteIds, user, lookupSite);
}

/**
 * Verifica que req.user.tipo esté en la lista de roles permitidos.
 */
function requireRole(...allowedRoles) {
  const set = new Set(allowedRoles);
  return (req, res, next) => {
    const u = req.user;
    if (!u) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (!set.has(u.tipo)) {
      return res.status(403).json({ ok: false, error: 'Permiso insuficiente' });
    }
    next();
  };
}

module.exports = { requireSiteAccess, requireRole, findUnauthorizedSiteIds };
