const pool = require('../config/db');

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
  const { rows } = await pool.query(
    `SELECT empresa_id, sub_empresa_id FROM sitio WHERE id = $1`,
    [siteId],
  );
  if (rows.length === 0) return null;
  const entry = { ...rows[0], exp: now + CACHE_TTL };
  siteCache.set(siteId, entry);
  return entry;
}

/**
 * Verifica que el req.user tenga acceso al sitio identificado por req.params[paramName].
 * - SuperAdmin: bypass total.
 * - Admin: empresa_id del user debe coincidir con empresa_id del sitio.
 * - Gerente: sub_empresa_id del user debe coincidir con sub_empresa_id del sitio.
 * - Cliente: empresa_id debe coincidir (Cliente puede ver datos de toda su empresa).
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

      if (u.tipo === 'Gerente') {
        if (!u.sub_empresa_id || u.sub_empresa_id !== site.sub_empresa_id) {
          return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
        }
        return next();
      }

      // Admin y Cliente: deben pertenecer a la empresa del sitio.
      if (u.empresa_id && u.empresa_id === site.empresa_id) return next();
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
    } catch (err) {
      console.error('[coldRoomAccess] error:', err.message);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  };
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

module.exports = { requireSiteAccess, requireRole };
