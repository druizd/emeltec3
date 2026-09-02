export interface SiteRecord {
  id: string;
  descripcion: string;
  empresa_id: string;
  sub_empresa_id: string;
  id_serial: string;
  ubicacion?: string | null;
  /** UTM northing en metros (WGS84). NULL para sitios legacy. */
  coord_norte?: number | string | null;
  /** UTM easting en metros (WGS84). NULL para sitios legacy. */
  coord_este?: number | string | null;
  /** Zona UTM (1-60). Chile usa 18 (norte), 19 (centro) o 20 (sur). */
  huso?: number | null;
  tipo_sitio: string;
  activo: boolean;
  /** Override visual: si true, el sitio se agrupa bajo "Maletas Piloto" en el
   * sidebar/dashboard sin importar su tipo_sitio. La lógica de detalle sigue
   * usando tipo_sitio (un pozo marcado sigue abriendo la vista de pozo). */
  es_maleta_piloto?: boolean;
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
  /** Caudal máximo DGA en litros por segundo. Usado para calcular % de caudal. */
  dga_caudal_max_lps?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSitePayload {
  descripcion: string;
  id_serial: string;
  ubicacion?: string | null;
  coord_norte?: number | string | null;
  coord_este?: number | string | null;
  huso?: number | null;
  tipo_sitio: string;
  activo: boolean;
  es_maleta_piloto?: boolean;
  pozo_config?: PozoConfig | null;
}

/** Sitio asociado a un serial detectado. Un serial puede tener varios. */
export interface DetectedDeviceSite {
  id: string;
  descripcion: string;
  tipo_sitio?: string | null;
  activo?: boolean | null;
}

export interface DetectedDevice {
  id_serial: string;
  total_registros: number;
  total_datos?: number;
  ultimo_registro: string;
  ultimo_registro_local?: string | null;
  ultima_medicion?: string | null;
  ultima_medicion_local?: string | null;
  ultima_llegada?: string | null;
  ultima_llegada_local?: string | null;
  desfase_segundos?: number | null;
  /** Primer sitio del serial. Se mantiene por compatibilidad; ver `sitios`. */
  sitio_id?: string | null;
  sitio_descripcion?: string | null;
  /** Todos los sitios que comparten el serial (misma subempresa). */
  sitios?: DetectedDeviceSite[] | null;
  sitios_count?: number;
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

/** Un rol histórico dentro de una fila: caudal, nivel, totalizador, freático. */
export interface SiteDashboardHistoryRole {
  ok: boolean;
  valor: number | string | null;
  unidad?: string | null;
  alias?: string | null;
  error?: string | null;
}

/**
 * Una señal digital dentro de una fila histórica. `valor` es 1 o 0 — nunca un
 * booleano, para que el gráfico y el CSV la traten como cualquier otra serie.
 * `ok: false` (con `error`) es un instante en que el bit no se pudo leer: no
 * es lo mismo que un 0 y no debe dibujarse como apagado.
 */
export interface SiteDashboardHistoryDigital {
  ok: boolean;
  valor: number | null;
  alias: string;
  bit: number;
  error: string | null;
}

export interface SiteDashboardHistoryEntry {
  timestamp: string;
  fecha?: string;
  received_at?: string | null;
  caudal?: SiteDashboardHistoryRole;
  nivel?: SiteDashboardHistoryRole;
  totalizador?: SiteDashboardHistoryRole;
  nivel_freatico?: SiteDashboardHistoryRole;
  /**
   * Señales digitales del sitio, indexadas por la clave de respuesta de cada
   * variable. Objeto vacío cuando el sitio no tiene ninguna configurada — el
   * shape de la fila no depende de la configuración.
   */
  digitales?: Record<string, SiteDashboardHistoryDigital>;
}

/** Paginación de `GET /api/companies/sites/:siteId/dashboard-history`. */
export interface SiteDashboardHistoryPagination {
  limit: number;
  page: number;
  page_size: number;
  /** `null` cuando el conteo total no se pudo calcular. */
  total: number | null;
  total_pages: number;
  has_more: boolean;
  granularity?: string;
  source?: string;
}

/**
 * `data` de `GET /api/companies/sites/:siteId/dashboard-history`.
 *
 * El endpoint NO devuelve un array plano: envuelve las filas junto al sitio y
 * la paginación. El tipo declaraba `SiteDashboardHistoryEntry[]` y los
 * componentes compensaban anotando la respuesta como `any`, lo que además
 * escondía el acceso a `data.pagination`.
 */
export interface SiteDashboardHistoryPayload {
  site: {
    id: string;
    descripcion: string | null;
    id_serial: string | null;
    tipo_sitio: string | null;
    activo?: boolean | null;
  };
  rows: SiteDashboardHistoryEntry[];
  pagination?: SiteDashboardHistoryPagination;
}
