import type { AlertaDia } from '../../../../services/alerta.service';

/**
 * Zona horaria con la que el worker de alertas decide "qué día es hoy"
 * (`ALERT_TIMEZONE`, default America/Santiago). El tester tiene que usar la
 * misma para que una lectura de las 23:30 del viernes no cuente como sábado.
 */
export const ALERTA_TIMEZONE = 'America/Santiago';

/** Índice de `Date#getDay()` → id de día, igual que DIAS_VALIDOS del worker. */
const DIAS_POR_INDICE: readonly AlertaDia[] = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];

const DIAS_POR_WEEKDAY: Record<string, AlertaDia> = {
  Sun: 'domingo',
  Mon: 'lunes',
  Tue: 'martes',
  Wed: 'miercoles',
  Thu: 'jueves',
  Fri: 'viernes',
  Sat: 'sabado',
};

/**
 * Día de la semana, en hora de Chile, de un instante UTC (`timestamp_completo`
 * de una fila cruda). `null` si el timestamp no se puede interpretar.
 */
export function diaSemanaDeInstante(iso: string, timeZone = ALERTA_TIMEZONE): AlertaDia | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
    new Date(ms),
  );
  return DIAS_POR_WEEKDAY[weekday] ?? null;
}

/**
 * Día de la semana de una fecha calendario `YYYY-MM-DD` (el `dia` de los
 * contadores diarios ya viene en día Chile, así que no hay zona que aplicar).
 */
export function diaSemanaDeFecha(fecha: string): AlertaDia | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : (DIAS_POR_INDICE[d.getUTCDay()] ?? null);
}

/**
 * Mismo criterio que `estaActivoHoy` del worker: sin días configurados la
 * regla corre siempre. Un día indeterminable no se descarta, para no esconder
 * lecturas por un timestamp raro.
 */
export function esDiaActivo(dia: AlertaDia | null, diasActivos: readonly AlertaDia[]): boolean {
  if (!diasActivos.length || dia === null) return true;
  return diasActivos.includes(dia);
}
