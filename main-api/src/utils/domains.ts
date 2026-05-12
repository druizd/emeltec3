/**
 * Resuelve catálogo de dominios desde tabla `public.domains` con fallback.
 */
import { pool } from '../config/db';

export interface Domain {
  id: number;
  slug: string;
  name: string;
}

const FALLBACK_DOMAINS: Domain[] = [
  { id: 1, slug: 'agua', name: 'Agua' },
  { id: 2, slug: 'electrico', name: 'Eléctrico' },
  { id: 3, slug: 'pozos', name: 'Pozos' },
];

let domainsCache: Domain[] = [];
let lastRefresh = 0;
const CACHE_TTL = 60_000;
let domainsTableChecked = false;
let domainsTableExists = false;

export async function hasDomainsTable(): Promise<boolean> {
  if (domainsTableChecked) return domainsTableExists;
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'domains'
       ) AS exists`,
    );
    domainsTableExists = Boolean(rows[0]?.exists);
  } catch {
    domainsTableExists = false;
  }
  domainsTableChecked = true;
  return domainsTableExists;
}

async function refreshDomains(): Promise<Domain[]> {
  const now = Date.now();
  if (domainsCache.length > 0 && now - lastRefresh < CACHE_TTL) return domainsCache;
  try {
    if (await hasDomainsTable()) {
      const { rows } = await pool.query<Domain>(
        'SELECT id, slug, name FROM public.domains ORDER BY id',
      );
      domainsCache = rows.length > 0 ? rows : FALLBACK_DOMAINS;
    } else {
      domainsCache = FALLBACK_DOMAINS;
    }
    lastRefresh = now;
  } catch (err) {
    console.error('[domains] Error al refrescar dominios:', (err as Error).message);
    domainsCache = domainsCache.length > 0 ? domainsCache : FALLBACK_DOMAINS;
  }
  return domainsCache;
}

export async function getDomain(slug: string): Promise<Domain | null> {
  const domains = await refreshDomains();
  return domains.find((d) => d.slug === slug) ?? null;
}

export async function listDomains(): Promise<Domain[]> {
  return refreshDomains();
}
