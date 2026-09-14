/**
 * Zona horaria Chile continental fija UTC-4 (sin DST).
 * 'Etc/GMT+4' es POSIX con signo invertido y equivale a UTC-4.
 * Usar para todos los Intl.DateTimeFormat y reportes DGA.
 */
export const CHILE_TIME_ZONE = 'Etc/GMT+4';

/** Etiqueta corta para rotular columnas, ejes y leyendas de esta zona. */
export const CHILE_TIME_ZONE_LABEL = 'UTC-4';

/**
 * Hora de pared de `tz` para `instant`, releída como si fuera UTC. La
 * diferencia contra el instante original es el offset real de esa zona, sin
 * pasar por la zona del navegador — que en esta app normalmente ya es Chile y
 * daría 0.
 */
function wallClockAsUtcMs(instant: Date, tz: string): number {
  // 'sv-SE' entrega 'YYYY-MM-DD HH:mm:ss', el único formato local que se puede
  // reparsear como ISO agregándole la T y la Z.
  const wall = instant.toLocaleString('sv-SE', { timeZone: tz });
  return new Date(`${wall.replace(' ', 'T')}Z`).getTime();
}

/**
 * Horas que el reloj de pared de Chile le lleva al UTC-4 fijo con que trabaja
 * la plataforma: `0` en invierno y `1` mientras rige el horario de verano
 * (primer sábado de septiembre a primer sábado de abril).
 *
 * Sirve para explicar el desfase en pantalla solo cuando existe de verdad, en
 * vez de hardcodear las fechas del decreto, que cambian por resolución.
 */
export function chileSummerTimeOffsetHours(now: Date = new Date()): number {
  const diffMs = wallClockAsUtcMs(now, 'America/Santiago') - wallClockAsUtcMs(now, CHILE_TIME_ZONE);
  return Math.round(diffMs / 3_600_000);
}

/** `true` mientras Chile continental está en horario de verano. */
export function isChileSummerTime(now: Date = new Date()): boolean {
  return chileSummerTimeOffsetHours(now) > 0;
}
