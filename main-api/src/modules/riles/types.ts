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

// ── Fase 2: laboratorio ──────────────────────────────────────────────────────

export const TIPOS_MUESTRA = ['autocontrol', 'fiscalizacion', 'interna'] as const;
export type RilesTipoMuestra = (typeof TIPOS_MUESTRA)[number];

export const TIPOS_LIMITE = ['concentracion', 'carga'] as const;
export type RilesTipoLimite = (typeof TIPOS_LIMITE)[number];

/**
 * `sin_limite`   = nadie declaró un límite para ese parámetro y esa norma.
 * `sin_comparar` = hay límite, pero no se puede contrastar: las unidades no son
 *                  convertibles entre sí, o el "< LD" del laboratorio cae por
 *                  encima del límite y el método no alcanza a resolverlo.
 */
export type RilesEstadoResultado = 'ok' | 'excede' | 'bajo_minimo' | 'sin_limite' | 'sin_comparar';

export interface RilesParametro {
  codigo: string;
  nombre: string;
  unidad: string;
  aplica_carga: boolean;
  grupo: string;
  orden: number;
  activo: boolean;
}

export interface RilesLimite {
  id: string;
  sitio_id: string;
  parametro: string;
  norma: RilesNorma;
  tipo: RilesTipoLimite;
  limite_min: number | null;
  limite_max: number | null;
  unidad: string;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  nota: string | null;
  parametro_nombre?: string | null;
  created_at?: string;
}

export interface RilesResultado {
  id: string;
  muestra_id: string;
  parametro: string;
  valor: number;
  unidad: string;
  /** El laboratorio informó "< LD": `valor` es el límite de detección. */
  bajo_ld: boolean;
  nota: string | null;
}

export interface RilesMuestra {
  id: string;
  sitio_id: string;
  fecha_muestra: string;
  tipo: RilesTipoMuestra;
  laboratorio: string | null;
  n_informe: string | null;
  punto: string | null;
  documento_id: string | null;
  nota: string | null;
  created_at?: string;
  created_by?: string | null;
  resultados: RilesResultado[];
}

export interface RilesResultadoEvaluado extends RilesResultado {
  parametro_nombre: string | null;
  /** Unidad canónica del catálogo, a la que se llevó `valor` para comparar. */
  unidad_canonica: string | null;
  valor_norm: number | null;
  /** NULL si el parámetro no tiene carga (pH, temperatura) o si falta volumen. */
  carga_kg: number | null;
  /** La carga salió de un "< LD": es una cota superior, no una medición. */
  carga_es_cota: boolean;
  estado: RilesEstadoResultado;
  limite_min: number | null;
  limite_max: number | null;
  limite_unidad: string | null;
  /** Cuánto del techo ocupa el valor, en %. Alimenta la barra de la vista. */
  uso_limite_pct: number | null;
}

export interface RilesMuestraEvaluada extends Omit<RilesMuestra, 'resultados'> {
  /** Volumen descargado el día de la muestra. NULL si no hay balance ese día. */
  volumen_dia_m3: number | null;
  /** El volumen vino del coeficiente declarado, no de un medidor. */
  volumen_estimado: boolean;
  norma: RilesNorma | null;
  resultados: RilesResultadoEvaluado[];
  n_excede: number;
}
