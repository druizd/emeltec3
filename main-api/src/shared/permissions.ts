/**
 * Reglas de autorización centralizadas. Reemplazan funciones sueltas en
 * controladores (`canReadSite`, `requireSuperAdmin`, `isSuperAdmin`).
 */
import { ForbiddenError } from './errors';

export type UserTipo = 'SuperAdmin' | 'Admin' | 'Gerente' | 'Cliente' | 'Empresa' | 'SubEmpresa';

export interface AuthUser {
  id?: string | number;
  email?: string;
  tipo: UserTipo;
  empresa_id?: string | null;
  sub_empresa_id?: string | null;
}

export interface SiteScope {
  empresa_id?: string | null;
  sub_empresa_id?: string | null;
}

export function isSuperAdmin(user: AuthUser | undefined): boolean {
  return user?.tipo === 'SuperAdmin';
}

export function requireSuperAdmin(user: AuthUser | undefined): void {
  if (!isSuperAdmin(user)) {
    throw new ForbiddenError('Solo un SuperAdmin puede administrar empresas, sitios y variables.');
  }
}

export function canReadSite(user: AuthUser | undefined, site: SiteScope | null | undefined): boolean {
  if (!user || !site) return false;
  if (user.tipo === 'SuperAdmin') return true;
  if (user.tipo === 'Admin' || user.tipo === 'Empresa') return user.empresa_id === site.empresa_id;
  if (user.tipo === 'Gerente' || user.tipo === 'Cliente' || user.tipo === 'SubEmpresa') {
    return (
      user.empresa_id === site.empresa_id && user.sub_empresa_id === site.sub_empresa_id
    );
  }
  return false;
}

export function requireSiteAccess(
  user: AuthUser | undefined,
  site: SiteScope | null | undefined,
): void {
  if (!canReadSite(user, site)) {
    throw new ForbiddenError('No tiene permisos para consultar datos de este sitio.');
  }
}

/** Devuelve la lista de empresa_id / sub_empresa_id que el usuario puede ver. */
export interface TenantScope {
  /** null => SuperAdmin, sin filtro */
  empresaIds: string[] | null;
  /** null => sin filtro a nivel sub_empresa */
  subEmpresaIds: string[] | null;
}

export function scopeByTenant(user: AuthUser | undefined): TenantScope {
  if (!user) return { empresaIds: [], subEmpresaIds: [] };
  if (user.tipo === 'SuperAdmin') return { empresaIds: null, subEmpresaIds: null };
  if (user.tipo === 'Admin' || user.tipo === 'Empresa') {
    return {
      empresaIds: user.empresa_id ? [user.empresa_id] : [],
      subEmpresaIds: null,
    };
  }
  if (user.tipo === 'Gerente' || user.tipo === 'Cliente' || user.tipo === 'SubEmpresa') {
    return {
      empresaIds: user.empresa_id ? [user.empresa_id] : [],
      subEmpresaIds: user.sub_empresa_id ? [user.sub_empresa_id] : [],
    };
  }
  return { empresaIds: [], subEmpresaIds: [] };
}
