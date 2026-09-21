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

// ── Laboratorio (fase 2) ─────────────────────────────────────────────────────

/** Quién tomó la muestra. Define el peso que tiene el resultado. */
export type RilesTipoMuestra = 'autocontrol' | 'fiscalizacion' | 'interna';

/** Un límite se escribe en concentración (mg/L) o en carga (kg por período). */
export type RilesTipoLimite = 'concentracion' | 'carga';

/**
 * Veredicto de un resultado contra su límite.
 *
 * `sin_limite`   = nadie declaró un límite para ese parámetro y esa norma.
 * `sin_comparar` = hay límite, pero no se puede contrastar: las unidades no son
 *                  convertibles, o el "< LD" del laboratorio cae por encima del
 *                  límite y el método no alcanza a resolverlo. Nunca `excede`:
 *                  el valor real puede estar de los dos lados.
 */
export type RilesEstadoResultado = 'ok' | 'excede' | 'bajo_minimo' | 'sin_limite' | 'sin_comparar';

/** Una fila del catálogo global de parámetros. No cuelga del sitio. */
export interface RilesParametro {
  codigo: string;
  nombre: string;
  /** Unidad canónica. Un resultado en otra unidad se convierte a ésta. */
  unidad: string;
  /**
   * FALSE para lo que no es una concentración másica: pH (logarítmico),
   * temperatura (intensiva), coliformes (recuento). Multiplicarlos por m³ no
   * da kg de nada, así que su carga queda en NULL.
   */
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
  /** Piso. Sólo el pH y la temperatura lo usan en la práctica. */
  limite_min: number | null;
  limite_max: number | null;
  unidad: string;
  /** `YYYY-MM-DD`. */
  vigencia_desde: string;
  /** `YYYY-MM-DD`, o NULL si sigue vigente. */
  vigencia_hasta: string | null;
  nota: string | null;
  /** Poblado por el JOIN con el catálogo; no viaja en el POST. */
  parametro_nombre?: string | null;
  created_at?: string;
}

export interface CreateRilesLimitePayload {
  parametro: string;
  norma: RilesNorma;
  tipo?: RilesTipoLimite;
  limite_min?: number | null;
  limite_max?: number | null;
  unidad: string;
  vigencia_desde: string;
  vigencia_hasta?: string | null;
  nota?: string | null;
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

/** Un resultado ya cruzado con el catálogo, su límite vigente y el volumen. */
export interface RilesResultadoEvaluado extends RilesResultado {
  parametro_nombre: string | null;
  unidad_canonica: string | null;
  /** `valor` llevado a la unidad canónica. NULL si no fue convertible. */
  valor_norm: number | null;
  /** Carga contaminante: mg/L × m³ ÷ 1000. NULL si no aplica o falta volumen. */
  carga_kg: number | null;
  /** La carga salió de un "< LD": es una cota superior, no una medición. */
  carga_es_cota: boolean;
  estado: RilesEstadoResultado;
  /** El límite ya convertido a la unidad canónica del parámetro. */
  limite_min: number | null;
  limite_max: number | null;
  /** Unidad en que se declaró el límite, antes de convertir. */
  limite_unidad: string | null;
  /** Cuánto del techo ocupa el valor, en %. Alimenta la barra de la vista. */
  uso_limite_pct: number | null;
}

export interface RilesMuestra {
  id: string;
  sitio_id: string;
  /** Fecha de la TOMA, no la del informe. `YYYY-MM-DD`. */
  fecha_muestra: string;
  tipo: RilesTipoMuestra;
  laboratorio: string | null;
  n_informe: string | null;
  punto: string | null;
  /** Id en `documentos` del PDF del laboratorio. */
  documento_id: string | null;
  nota: string | null;
  created_at?: string;
  created_by?: string | null;
  resultados: RilesResultado[];
}

export interface RilesMuestraEvaluada extends Omit<RilesMuestra, 'resultados'> {
  /** Volumen descargado el día de la muestra. NULL si no hay balance ese día. */
  volumen_dia_m3: number | null;
  /** El volumen vino del coeficiente declarado, no de un medidor. */
  volumen_estimado: boolean;
  /** La norma del sitio al momento de evaluar. NULL si no está configurada. */
  norma: RilesNorma | null;
  resultados: RilesResultadoEvaluado[];
  /** Cuántos resultados se pasan del límite, por arriba o por abajo. */
  n_excede: number;
}

export interface CreateRilesMuestraPayload {
  fecha_muestra: string;
  tipo?: RilesTipoMuestra;
  laboratorio?: string | null;
  n_informe?: string | null;
  punto?: string | null;
  documento_id?: string | null;
  nota?: string | null;
  resultados: {
    parametro: string;
    valor: number;
    unidad: string;
    bajo_ld?: boolean;
    nota?: string | null;
  }[];
}
