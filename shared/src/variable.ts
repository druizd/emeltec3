import type { SiteRecord, PozoConfig } from './site';

export interface VariableParameters {
  factor?: number | null;
  offset?: number | null;
  /**
   * Escalado por rango: el técnico define el rango bruto que entrega el equipo
   * (un 4-20 mA suele llegar como 4000-20000) y el rango en unidades de
   * ingeniería. `factor` y `offset` se derivan de estos cuatro valores y
   * siguen siendo lo único que lee el backend — estas llaves solo conservan la
   * intención para poder reeditar la variable.
   */
  modo_escala?: 'rango' | null;
  raw_min?: number | null;
  raw_max?: number | null;
  ing_min?: number | null;
  ing_max?: number | null;
  /**
   * Complemento a 2: un registro Modbus no lleva signo, asi que el PLC manda
   * -449 como 65087. `signo_bits` es el ancho del registro (16 para uno
   * suelto, 32 para el par combinado).
   */
  con_signo?: boolean | null;
  signo_bits?: number | null;
  word_order?: string | null;
  word_swap?: boolean | null;
  wordSwap?: boolean | null;
  formato?: string | null;
  formula?: string | null;
}

export interface VariableMapping {
  id: string;
  alias: string;
  d1: string;
  d2?: string | null;
  tipo_dato: string;
  unidad?: string | null;
  rol_dashboard?: string | null;
  transformacion?: string | null;
  parametros?: VariableParameters | null;
  sitio_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface SiteVariable {
  nombre_dato: string;
  valor_dato: string | number | boolean | null;
  timestamp_completo: string;
  mapping: VariableMapping | null;
}

export interface SiteVariablesPayload {
  site: SiteRecord;
  pozo_config: PozoConfig | null;
  variables: SiteVariable[];
  mappings: VariableMapping[];
}

export interface CreateVariableMapPayload {
  alias: string;
  d1: string;
  d2?: string | null;
  tipo_dato: string;
  unidad?: string | null;
  rol_dashboard?: string | null;
  transformacion?: string | null;
  parametros?: VariableParameters | null;
}
