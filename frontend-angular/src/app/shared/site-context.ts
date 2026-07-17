import type { CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';

/**
 * Contexto mínimo de navegación que une company, subempresa y sitio.
 * Compartido por todos los componentes de detalle de sitio.
 */
export interface SiteContext {
  company: CompanyNode;
  subCompany: SubCompanyNode;
  site: SiteRecord;
}

/**
 * Busca el primer sitio con `siteId` dentro del árbol de jerarquía devuelto
 * por `CompanyService.fetchHierarchy()`. Retorna `null` si no se encuentra
 * (por ejemplo, si el usuario no tiene acceso al sitio).
 */
export function findAccessibleSite(tree: CompanyNode[], siteId: string): SiteContext | null {
  for (const company of tree || []) {
    for (const subCompany of company.subCompanies || []) {
      const site = (subCompany.sites || []).find((item: SiteRecord) => item.id === siteId);
      if (site) return { company, subCompany, site };
    }
  }

  return null;
}
