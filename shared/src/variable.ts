import type { SiteRecord, PozoConfig } from './site';

export interface VariableParameters {
  factor?: number | null;
  offset?: number | null;
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
