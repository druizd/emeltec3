/**
 * Tipos del modulo contadores: agregado mensual generico de variables tipo
 * contador (totalizador, energia, volumen, ...).
 */

export const COUNTER_ROLES = ['totalizador', 'energia', 'volumen'] as const;
export type CounterRole = (typeof COUNTER_ROLES)[number];

export interface ContadorMensualRow {
  sitio_id: string;
  variable_id: string;
  rol: string;
  mes: string;
  valor_inicio: number | null;
  valor_fin: number | null;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  resets_detectados: number;
  ultimo_dato: string | null;
  actualizado_at: string;
}

export interface MonthDeltaResult {
  valor_inicio: number | null;
  valor_fin: number | null;
  delta: number | null;
  muestras: number;
  resets_detectados: number;
  ultimo_dato: string | null;
}

export interface ContadorMensualPoint {
  mes: string;
  delta: number | null;
  unidad: string | null;
  muestras: number;
  ultimo_dato: string | null;
  resets_detectados: number;
  proyeccion?: number | null;
}

export interface ContadorDiarioPoint {
  dia: string; // 'YYYY-MM-DD' en zona Chile
  delta: number | null;
  unidad: string | null;
  muestras: number;
  ultimo_dato: string | null;
  resets_detectados: number;
}

export interface ContadorJornadaPoint {
  dia: string; // 'YYYY-MM-DD' Chile (dia en que arranca la jornada)
  inicio: string; // 'HH:MM'
  fin: string; // 'HH:MM'
  delta: number | null;
  unidad: string | null;
  muestras: number;
  ultimo_dato: string | null;
  resets_detectados: number;
}
