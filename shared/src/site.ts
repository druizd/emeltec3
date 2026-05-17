export interface SiteRecord {
  id: string;
  descripcion: string;
  empresa_id: string;
  sub_empresa_id: string;
  id_serial: string;
  ubicacion?: string | null;
  tipo_sitio: string;
  activo: boolean;
  /** Populated por companies/tree (attachPozoConfigsToSites). Opcional en otros contextos. */
  pozo_config?: PozoConfig | null;
  /** Populated por companies/tree (attachLastSeenToSites) — MAX(equipo.time) por id_serial. */
  last_seen_at?: string | null;
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
  total_datos?: number;
  ultimo_registro: string;
  ultimo_registro_local?: string | null;
  sitio_id?: string | null;
  sitio_descripcion?: string | null;
  empresa_id?: string | null;
  empresa_nombre?: string | null;
  sub_empresa_id?: string | null;
  sub_empresa_nombre?: string | null;
}

export interface DashboardVariable {
  key?: string | null;
  alias?: string | null;
  rol_dashboard?: string | null;
  transformacion?: string | null;
  unidad?: string | null;
  ok?: boolean;
  valor?: string | number | null;
}

export interface DashboardResumenEntry {
  valor?: string | number | null;
  ok?: boolean;
  unidad?: string | null;
}

export interface SiteDashboardData {
  server_time?: string | null;
  pozo_config?: {
    profundidad_pozo_m?: number | string | null;
    profundidad_sensor_m?: number | string | null;
  } | null;
  ultima_lectura?: {
    time?: string | null;
    timestamp_completo?: string | null;
    received_at?: string | null;
    id_serial?: string | null;
  } | null;
  resumen?: Record<string, DashboardResumenEntry | undefined>;
  variables?: DashboardVariable[];
}

export interface SiteDashboardHistoryEntry {
  timestamp: string;
  variables: Record<string, string | number | boolean | null>;
}
