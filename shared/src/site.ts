export interface SiteRecord {
  id: string;
  descripcion: string;
  empresa_id: string;
  sub_empresa_id: string;
  id_serial: string;
  ubicacion?: string | null;
  tipo_sitio: string;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PozoConfig {
  sitio_id?: string;
  profundidad_pozo_m?: number | null;
  profundidad_sensor_m?: number | null;
  nivel_estatico_manual_m?: number | null;
  obra_dga?: string | null;
  slug?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSitePayload {
  descripcion: string;
  id_serial: string;
  ubicacion?: string | null;
  tipo_sitio: string;
  activo: boolean;
  pozo_config?: PozoConfig | null;
}

export interface DetectedDevice {
  id_serial: string;
  total_registros: number;
  ultimo_registro: string;
  sitio_id?: string | null;
  sitio_descripcion?: string | null;
  empresa_id?: string | null;
  empresa_nombre?: string | null;
  sub_empresa_id?: string | null;
  sub_empresa_nombre?: string | null;
}

export interface SiteDashboardData {
  site: SiteRecord;
  pozo_config: PozoConfig | null;
  variables: Record<string, unknown>;
  last_update?: string | null;
}

export interface SiteDashboardHistoryEntry {
  timestamp: string;
  variables: Record<string, string | number | boolean | null>;
}
