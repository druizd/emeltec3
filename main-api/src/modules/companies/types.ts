export interface Company {
  id: string;
  nombre: string;
  rut: string;
  tipo_empresa: string | null;
  sitios?: number;
}

export interface SubCompany {
  id: string;
  nombre: string;
  rut: string;
  empresa_id: string;
}

export interface HierarchyNode extends Company {
  subCompanies: Array<
    SubCompany & {
      sites: HierarchySite[];
    }
  >;
}

export interface HierarchySite {
  id: string;
  descripcion: string;
  empresa_id: string | null;
  sub_empresa_id: string | null;
  id_serial: string | null;
  ubicacion: string | null;
  tipo_sitio: string;
  activo: boolean;
  pozo_config?: unknown;
}
