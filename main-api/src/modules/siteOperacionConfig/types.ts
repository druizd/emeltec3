/**
 * Tipos del modulo siteOperacionConfig: config persistente por sitio para
 * turnos (2 o 3 turnos con HH:MM) y la jornada de Resumen Operacional.
 */

export interface TurnoConfig {
  nombre: string;
  inicio: string; // HH:MM
  fin: string; // HH:MM
}

export interface SiteOperacionConfig {
  sitio_id: string;
  num_turnos: 2 | 3;
  turnos: TurnoConfig[];
  jornada_inicio: string;
  jornada_fin: string;
  updated_at: string;
}

export const DEFAULT_TURNOS: TurnoConfig[] = [
  { nombre: 'Turno 1', inicio: '07:00', fin: '14:59' },
  { nombre: 'Turno 2', inicio: '15:00', fin: '22:59' },
  { nombre: 'Turno 3', inicio: '23:00', fin: '06:59' },
];

export const DEFAULT_CONFIG = {
  num_turnos: 3 as const,
  turnos: DEFAULT_TURNOS,
  jornada_inicio: '07:00',
  jornada_fin: '07:00',
};
