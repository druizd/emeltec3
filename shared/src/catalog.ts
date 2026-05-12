export interface SiteTypeRoleOption {
  id: string;
  label: string;
  unitHint?: string | null;
  description?: string | null;
}

export interface SiteTypeTransformOption {
  id: string;
  label: string;
  description?: string | null;
  enabled?: boolean;
  requiresD2?: boolean;
}

export interface SiteTypeCatalogItem {
  id: string;
  label: string;
  roles: SiteTypeRoleOption[];
  transforms: SiteTypeTransformOption[];
}

export type SiteTypeCatalogResponse = Record<string, SiteTypeCatalogItem>;
