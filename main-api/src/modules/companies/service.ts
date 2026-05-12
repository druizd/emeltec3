/**
 * Servicio de companies: ensambla árbol jerárquico empresa → sub_empresa → sitio
 * según el scope del usuario. Hot-path en login y panel principal.
 */
import { scopeByTenant, type AuthUser } from '../../shared/permissions';
import { attachPozoConfigsToSites, listCompanies, listSites, listSubCompanies } from './repo';
import type { HierarchyNode, HierarchySite, SubCompany } from './types';

export async function getHierarchyTreeForUser(user: AuthUser): Promise<HierarchyNode[]> {
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

  const sites = await attachPozoConfigsToSites(sitesRaw);
  const sitesBySub = groupBy(sites, (s) => s.sub_empresa_id ?? '__none__');
  const subsByCompany = groupBy(subCompanies, (sc) => sc.empresa_id);

  return companies.map((company) => ({
    ...company,
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
