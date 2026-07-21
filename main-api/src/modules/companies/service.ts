/**
 * Servicio de companies: ensambla árbol jerárquico empresa → sub_empresa → sitio
 * según el scope del usuario. Hot-path en login y panel principal.
 */
import { scopeByTenant, type AuthUser } from '../../shared/permissions';
import {
  attachLastSeenToSites,
  attachPozoConfigsToSites,
  listCompanies,
  listSites,
  listSitesForVendedor,
  listSubCompanies,
} from './repo';
import type { HierarchyNode, HierarchySite, SubCompany } from './types';

export async function getHierarchyTreeForUser(user: AuthUser): Promise<HierarchyNode[]> {
  // Vendedor: scope a nivel SITIO (maletas piloto + asignadas), no por tenant.
  // Se traen sus sitios y se derivan las empresas/sub-empresas a mostrar.
  if (user.tipo === 'Vendedor') {
    const sitesRaw = await listSitesForVendedor(String(user.id ?? ''));
    if (sitesRaw.length === 0) return [];
    const empresaIds = [
      ...new Set(sitesRaw.map((s) => s.empresa_id).filter((x): x is string => !!x)),
    ];
    const subEmpresaIds = [
      ...new Set(sitesRaw.map((s) => s.sub_empresa_id).filter((x): x is string => !!x)),
    ];
    const [companies, subCompanies] = await Promise.all([
      listCompanies(empresaIds),
      listSubCompanies(empresaIds, subEmpresaIds),
    ]);
    return buildTree(companies, subCompanies, await enrichSites(sitesRaw));
  }

  const scope = scopeByTenant(user);
  // Si el usuario no tiene scope válido, devolver vacío sin tocar DB.
  if (
    (scope.empresaIds !== null && scope.empresaIds.length === 0) ||
    (scope.subEmpresaIds !== null && scope.subEmpresaIds.length === 0)
  ) {
    return [];
  }

  const [companies, subCompanies, sitesRaw] = await Promise.all([
    listCompanies(scope.empresaIds),
    listSubCompanies(scope.empresaIds, scope.subEmpresaIds),
    listSites(scope.empresaIds, scope.subEmpresaIds),
  ]);

  return buildTree(companies, subCompanies, await enrichSites(sitesRaw));
}

/** Adjunta pozo_config + last_seen a los sitios. */
async function enrichSites(sitesRaw: HierarchySite[]): Promise<HierarchySite[]> {
  const sitesWithPozo = await attachPozoConfigsToSites(sitesRaw);
  return attachLastSeenToSites(sitesWithPozo);
}

function buildTree(
  companies: { id: string }[],
  subCompanies: SubCompany[],
  sites: HierarchySite[],
): HierarchyNode[] {
  const sitesBySub = groupBy(sites, (s) => s.sub_empresa_id ?? '__none__');
  const subsByCompany = groupBy(subCompanies, (sc) => sc.empresa_id);
  return companies.map((company) => ({
    ...(company as HierarchyNode),
    subCompanies: (subsByCompany.get(company.id) ?? []).map((sub: SubCompany) => ({
      ...sub,
      sites: (sitesBySub.get(sub.id) ?? []) as HierarchySite[],
    })),
  }));
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}
