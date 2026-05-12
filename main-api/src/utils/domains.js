/**
 * Utilidades de dominio.
 * Resuelven el catalogo de dominios disponible para el modulo de catalogo.
 */
const pool = require('../config/db');

const FALLBACK_DOMAINS = [
  { id: 1, slug: 'agua', name: 'Agua' },
  { id: 2, slug: 'electrico', name: 'Eléctrico' },
  { id: 3, slug: 'pozos', name: 'Pozos' },
];

let domainsCache = [];
let lastRefresh = 0;
const CACHE_TTL = 60_000;
let domainsTableChecked = false;
let domainsTableExists = false;

async function hasDomainsTable() {
  if (domainsTableChecked) return domainsTableExists;

  try {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'domains'
       ) AS exists`,
    );
    domainsTableExists = Boolean(rows[0]?.exists);
  } catch (err) {
    domainsTableExists = false;
  }

  domainsTableChecked = true;
  return domainsTableExists;
}

async function refreshDomains() {
  const now = Date.now();
  if (domainsCache.length > 0 && now - lastRefresh < CACHE_TTL) {
    return domainsCache;
  }

  try {
    if (await hasDomainsTable()) {
      const { rows } = await pool.query('SELECT id, slug, name FROM public.domains ORDER BY id');
      domainsCache = rows.length > 0 ? rows : FALLBACK_DOMAINS;
    } else {
      domainsCache = FALLBACK_DOMAINS;
    }
    lastRefresh = now;
  } catch (err) {
    console.error('[domains] Error al refrescar dominios:', err.message);
    domainsCache = domainsCache.length > 0 ? domainsCache : FALLBACK_DOMAINS;
  }

  return domainsCache;
}

async function getDomain(slug) {
  const domains = await refreshDomains();
  return domains.find((domain) => domain.slug === slug) || null;
}

async function listDomains() {
  return refreshDomains();
}

module.exports = { getDomain, listDomains, hasDomainsTable };
