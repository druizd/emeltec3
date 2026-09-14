/**
 * Tipos del módulo riles. Espejo de `shared/src/riles.ts` — main-api no
 * consume el paquete shared, cada módulo declara lo suyo.
 */

export const MODOS_CAUDAL = ['propio', 'derivado', 'mixto'] as const;
export type RilesModoCaudal = (typeof MODOS_CAUDAL)[number];

export const NORMAS = ['ds90', 'ds46', 'ds609', 'rca'] as const;
export type RilesNorma = (typeof NORMAS)[number];

export const DIRECCIONES = ['entrada', 'salida'] as const;
export type RilesDireccion = (typeof DIRECCIONES)[number];

export type RilesGranularidad = 'dia' | 'mes';

export type RilesEstadoPeriodo = 'ok' | 'sobre' | 'bajo' | 'sin_banda' | 'sin_dato';

export interface RilesConfig {
  sitio_id: string;
  modo_caudal: RilesModoCaudal;
  coef_descarga_esperado_pct: number | null;
  /** Tolerancia en puntos porcentuales alrededor del coeficiente esperado. */
  coef_tolerancia_pct: number;
  norma: RilesNorma | null;
  punto_descarga: string | null;
  caudal_max_autorizado_lps: number | null;
  volumen_max_mensual_m3: number | null;
  updated_at?: string;
}

export interface RilesFuente {
  id: string;
  riles_sitio_id: string;
  fuente_sitio_id: string;
  rol: string;
  factor: number;
  direccion: RilesDireccion;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  nota: string | null;
  fuente_descripcion?: string | null;
  fuente_tipo_sitio?: string | null;
  created_at?: string;
}

export interface RilesBalanceAporte {
  fuente_id: string;
  sitio_id: string;
  descripcion: string | null;
  direccion: RilesDireccion;
  rol: string;
  factor: number;
  delta_m3: number | null;
  aporte_m3: number | null;
  unidad_origen: string | null;
  sin_dato: boolean;
  vigencia_parcial: boolean;
}

export interface RilesBalancePoint {
  periodo: string;
  volumen_entrada_m3: number | null;
  volumen_salida_m3: number | null;
  coeficiente_pct: number | null;
  consumo_neto_m3: number | null;
  estimado: boolean;
  completo: boolean;
  estado: RilesEstadoPeriodo;
  aportes: RilesBalanceAporte[];
}

export interface RilesBalancePayload {
  site: { id: string; descripcion: string | null; tipo_sitio: string | null };
  config: RilesConfig;
  granularidad: RilesGranularidad;
  desde: string;
  hasta: string;
  puntos: RilesBalancePoint[];
}

export const DEFAULT_CONFIG: Omit<RilesConfig, 'sitio_id'> = {
  modo_caudal: 'propio',
  coef_descarga_esperado_pct: null,
  coef_tolerancia_pct: 15,
  norma: null,
  punto_descarga: null,
  caudal_max_autorizado_lps: null,
  volumen_max_mensual_m3: null,
};
