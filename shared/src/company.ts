import type { SiteRecord } from './site';

export type CompanyType = 'Agua' | 'Riles' | 'Proceso' | 'Eléctrico' | string;

export interface SubCompany {
  id: string;
  nombre: string;
  rut?: string;
  empresa_id?: string;
}

export interface Company {
  id: string;
  nombre: string;
  rut: string;
  tipo_empresa: CompanyType;
  sitios?: number;
  sub_empresas?: SubCompany[];
}

export interface SubCompanyNode extends SubCompany {
  empresa_id: string;
  rut: string;
  sites: SiteRecord[];
}

export interface CompanyNode {
  id: string;
  nombre: string;
  rut: string;
  tipo_empresa: CompanyType;
  subCompanies: SubCompanyNode[];
}

export interface CreateCompanyPayload {
  nombre: string;
  rut: string;
  tipo_empresa: CompanyType;
}

export interface CreateSubCompanyPayload {
  nombre: string;
  rut: string;
}
