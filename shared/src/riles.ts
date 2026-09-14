/**
 * Tipos del módulo RILes: configuración del sitio, sus fuentes y el balance
 * hídrico que sale de cruzar las dos cosas.
 *
 * Ver docs/riles-propuesta-modulo.md.
 */

/** Cómo se arma el volumen de salida del sitio. */
export type RilesModoCaudal =
  /** Medidor propio en la descarga. */
  | 'propio'
  /** Sin medidor: se estima desde las entradas con `coef_descarga_esperado_pct`. */
  | 'derivado'
  /** El propio cuando hay dato en el período; el estimado cuando no. */
  | 'mixto';

/** Norma contra la que se compara la descarga. RILes es SISS/SMA, nunca DGA. */
export type RilesNorma = 'ds90' | 'ds46' | 'ds609' | 'rca';

export type RilesDireccion = 'entrada' | 'salida';

export type RilesGranularidad = 'dia' | 'mes';

/**
 * Estado del coeficiente de descarga del período contra la banda configurada.
 * `sin_banda` = no hay coeficiente esperado que comparar; `sin_dato` = hay
 * banda pero el período no tiene volumen suficiente para calcular nada.
 */
export type RilesEstadoPeriodo = 'ok' | 'sobre' | 'bajo' | 'sin_banda' | 'sin_dato';

export interface RilesConfig {
  sitio_id: string;
  modo_caudal: RilesModoCaudal;
  /** % del agua de entrada que se espera ver descargada. NULL = sin banda. */
  coef_descarga_esperado_pct: number | null;
  /** Tolerancia en **puntos porcentuales** alrededor del coeficiente esperado. */
  coef_tolerancia_pct: number;
  norma: RilesNorma | null;
  /** Código del punto de descarga o N° de la resolución que lo autoriza. */
  punto_descarga: string | null;
  caudal_max_autorizado_lps: number | null;
  volumen_max_mensual_m3: number | null;
  updated_at?: string;
}

export interface RilesFuente {
  id: string;
  riles_sitio_id: string;
  fuente_sitio_id: string;
  /** Rol de contador que se lee del sitio fuente. Casi siempre `totalizador`. */
  rol: string;
  /** Prorrateo del aporte. NO es el coeficiente de descarga. */
  factor: number;
  direccion: RilesDireccion;
  /** `YYYY-MM-DD`. */
  vigencia_desde: string;
  /** `YYYY-MM-DD`, o NULL si sigue vigente. */
  vigencia_hasta: string | null;
  nota: string | null;
  /** Poblado por el JOIN con `sitio`; no viaja en el POST. */
  fuente_descripcion?: string | null;
  fuente_tipo_sitio?: string | null;
  created_at?: string;
}

export interface CreateRilesFuentePayload {
  fuente_sitio_id: string;
  rol?: string;
  factor?: number;
  direccion?: RilesDireccion;
  vigencia_desde: string;
  vigencia_hasta?: string | null;
  nota?: string | null;
}

/** Lo que aportó una fuente a un período del balance. */
export interface RilesBalanceAporte {
  fuente_id: string;
  sitio_id: string;
  descripcion: string | null;
  direccion: RilesDireccion;
  rol: string;
  factor: number;
  /** Delta del contador ya normalizado a m³. NULL si la fuente no tuvo dato. */
  delta_m3: number | null;
  /** `delta_m3 × factor`. Es lo que suma al balance. */
  aporte_m3: number | null;
  /** Unidad original del contador, antes de normalizar. */
  unidad_origen: string | null;
  sin_dato: boolean;
  /** La ventana de vigencia no cubre el período completo. */
  vigencia_parcial: boolean;
}

export interface RilesBalancePoint {
  /** `YYYY-MM-01` en granularidad mes, `YYYY-MM-DD` en día. Hora Chile. */
  periodo: string;
  volumen_entrada_m3: number | null;
  volumen_salida_m3: number | null;
  /** `salida / entrada × 100`. NULL si no hay entrada con la que dividir. */
  coeficiente_pct: number | null;
  consumo_neto_m3: number | null;
  /** La salida del período no se midió: se estimó desde las entradas. */
  estimado: boolean;
  /** Todas las fuentes vigentes aportaron dato y cubrieron el período entero. */
  completo: boolean;
  estado: RilesEstadoPeriodo;
  aportes: RilesBalanceAporte[];
}

export interface RilesBalancePayload {
  site: {
    id: string;
    descripcion: string | null;
    tipo_sitio: string | null;
  };
  config: RilesConfig;
  granularidad: RilesGranularidad;
  desde: string;
  hasta: string;
  puntos: RilesBalancePoint[];
}
