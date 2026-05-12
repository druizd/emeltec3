/**
 * Tipos centrales del módulo sites.
 */

export type SiteType = 'pozo' | 'electrico' | 'proceso' | 'riles' | 'generico' | 'maleta';

export interface Site {
  id: string;
  descripcion: string;
  empresa_id: string | null;
  sub_empresa_id: string | null;
  id_serial: string | null;
  ubicacion: string | null;
  tipo_sitio: SiteType;
  activo: boolean;
}

export interface PozoConfig {
  sitio_id: string;
  profundidad_pozo_m: number | null;
  profundidad_sensor_m: number | null;
  nivel_estatico_manual_m: number | null;
  obra_dga: string | null;
  slug: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type TransformId =
  | 'directo'
  | 'lineal'
  | 'ieee754_32'
  | 'uint32_registros'
  | 'nivel_freatico'
  | 'caudal_m3h_lps'
  | 'formula';

export interface RegMap {
  id: string;
  alias: string;
  d1: string;
  d2: string | null;
  tipo_dato: string | null;
  unidad: string | null;
  rol_dashboard: string;
  transformacion: TransformId | string;
  parametros: Record<string, unknown>;
  sitio_id: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LatestEquipoRow {
  time: string | Date;
  received_at: string | Date | null;
  id_serial: string;
  data: Record<string, unknown>;
}

export interface HistoryEquipoRow extends LatestEquipoRow {
  timestamp_completo?: string;
}

export interface DashboardVariable {
  id: string;
  key: string;
  alias: string;
  rol_dashboard: string;
  transformacion: string;
  unidad: string | null;
  fuente: { d1: string; d2: string | null; variable?: string; alias?: string };
  crudo: { d1: unknown; d2: unknown; lectura_sensor_m?: number };
  ok: boolean;
  valor: unknown;
  error?: string;
  derivado?: boolean;
}

export interface DashboardResumen {
  [role: string]: {
    ok: boolean;
    valor: unknown;
    unidad: string | null;
    alias: string | null;
    error: string | null;
    fuente?: string;
  };
}

export interface DashboardData {
  server_time: string | null;
  site: Pick<Site, 'id' | 'descripcion' | 'id_serial' | 'tipo_sitio'>;
  pozo_config: PozoConfig | null;
  ultima_lectura: {
    time: string | null;
    timestamp_completo: string | null;
    received_at: string | null;
    id_serial: string;
  } | null;
  resumen: DashboardResumen;
  variables: DashboardVariable[];
}

export interface HistoricalRow {
  timestamp: string | null;
  fecha: string | null;
  received_at: string | null;
  caudal: HistoricalCell;
  nivel: HistoricalCell;
  totalizador: HistoricalCell;
  nivel_freatico: HistoricalCell;
}

export interface HistoricalCell {
  ok: boolean;
  valor: unknown;
  unidad: string | null;
  alias: string | null;
  error?: string | null;
}
