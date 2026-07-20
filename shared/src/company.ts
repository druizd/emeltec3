import type { SiteRecord } from './site';

export type CompanyType = 'Agua' | 'Riles' | 'Proceso' | 'Eléctrico' | string;

export interface SubCompany {
  id: string;
  nombre: string;
  rut?: string | null;
  empresa_id?: string;
}

export interface Company {
  id: string;
  nombre: string;
  rut?: string | null;
  tipo_empresa: CompanyType;
  sitios?: number;
  sub_empresas?: SubCompany[];
}

export interface SubCompanyNode extends SubCompany {
  empresa_id: string;
  rut?: string | null;
  sites: SiteRecord[];
}

export interface CompanyNode {
  id: string;
  nombre: string;
  rut?: string | null;
  tipo_empresa: CompanyType;
  subCompanies: SubCompanyNode[];
}

export type OperationalContactType =
  | 'Responsable'
  | 'Reporte DGA'
  | 'Emergencia'
  | 'Mantencion'
  | 'Operacion'
  | 'Comercial'
  | string;

export interface OperationalContact {
  id: string;
  empresa_id: string;
  sub_empresa_id: string;
  sitio_id?: string | null;
  usuario_id?: string | null;
  nombre: string;
  apellido?: string | null;
  email?: string | null;
  telefono?: string | null;
  cargo: string;
  tipo_contacto: OperationalContactType;
  notas?: string | null;
  /** true cuando el backend enmascaró tel/email: hay dato revelable con 2FA. */
  datos_ocultos?: boolean;
  empresa_nombre?: string | null;
  sub_empresa_nombre?: string | null;
  sitio_nombre?: string | null;
  usuario_tipo?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateOperationalContactPayload {
  empresa_id: string;
  sub_empresa_id: string;
  sitio_id?: string | null;
  usuario_id?: string | null;
  nombre: string;
  apellido?: string | null;
  email?: string | null;
  telefono?: string | null;
  cargo: string;
  tipo_contacto: OperationalContactType;
  notas?: string | null;
}

export interface CreateCompanyPayload {
  nombre: string;
  rut?: string | null;
  tipo_empresa: CompanyType;
}

export interface CreateSubCompanyPayload {
  nombre: string;
  rut?: string | null;
}
