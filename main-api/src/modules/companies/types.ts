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
  /** UTM northing (metros). NUMERIC viene como string desde pg. NULL si no seteado. */
  coord_norte?: number | string | null;
  /** UTM easting (metros). */
  coord_este?: number | string | null;
  /** Zona UTM (1-60). */
  huso?: number | null;
  tipo_sitio: string;
  activo: boolean;
  /** Sitio marcado como maleta piloto — el sidebar lo agrupa en su módulo propio. */
  es_maleta_piloto?: boolean;
  pozo_config?: unknown;
}
