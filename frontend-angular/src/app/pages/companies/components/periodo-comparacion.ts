/**
 * Cálculo de rangos y métricas para "Comparación de períodos por pozo" de la
 * Vista General. Funciones puras (sin Angular ni Date.now implícito) para que
 * el componente quede delgado y esto se pueda testear con fechas fijas.
 *
 * Todas las fechas son ISO 'YYYY-MM-DD' en hora de Chile. La aritmética se
 * hace sobre la medianoche UTC del ISO, así los cambios de hora de Chile no
 * producen días de 23 o 25 horas.
 */

export type PeriodoPresetKey = 'semana' | 'mes' | '7d';

export interface RangoPeriodo {
  label: string;
  desde: string;
  hasta: string;
}

export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Máximo de días hacia atrás que entrega `contadores-diarios` (zod max(120)). */
export const MAX_DIAS_CONTADORES = 120;

/** Máximo de días por consulta a `period-aggregates` (1 año). */
export const MAX_DIAS_AGREGADOS = 366;

/** Fecha de hoy en Chile como 'YYYY-MM-DD' (no la del navegador). */
export function hoyChileIso(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

/** Suma `dias` (puede ser negativo) a un ISO 'YYYY-MM-DD'. */
export function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Días inclusivos entre dos ISO 'YYYY-MM-DD' (desde ≤ hasta → ≥ 1). */
export function diasInclusivos(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** 'Septiembre 2026' a partir de cualquier ISO del mes. */
export function mesLabel(iso: string): string {
  const nombre = MESES[Number(iso.slice(5, 7)) - 1] ?? '';
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${iso.slice(0, 4)}`;
}

/**
 * Rangos A/B de cada preset, relativos a `hoy`. En los tres casos B cubre la
 * misma cantidad de días que A (no la semana o el mes completos) para que el
 * consumo acumulado sea comparable: 3 días de esta semana contra 3 días de la
 * anterior, no contra 7.
 */
export function presetPeriodos(
  preset: PeriodoPresetKey,
  hoy: string,
): { a: RangoPeriodo; b: RangoPeriodo } {
  if (preset === 'semana') {
    // getUTCDay sobre la medianoche UTC del ISO: 0 = domingo. Semana lunes→domingo.
    const dow = new Date(`${hoy}T00:00:00Z`).getUTCDay();
    const lunes = sumarDias(hoy, -((dow + 6) % 7));
    const transcurridos = diasInclusivos(lunes, hoy);
    const lunesPrev = sumarDias(lunes, -7);
    return {
      a: { label: 'Esta semana', desde: lunes, hasta: hoy },
      b: {
        label: 'Semana anterior · mismos días',
        desde: lunesPrev,
        hasta: sumarDias(lunesPrev, transcurridos - 1),
      },
    };
  }
  if (preset === 'mes') {
    const inicioMes = `${hoy.slice(0, 7)}-01`;
    const finMesPrev = sumarDias(inicioMes, -1);
    const inicioMesPrev = `${finMesPrev.slice(0, 7)}-01`;
    // Mismo día del mes anterior; si ese mes es más corto, su último día.
    const mismoDia = `${finMesPrev.slice(0, 7)}-${hoy.slice(8, 10)}`;
    return {
      a: { label: mesLabel(inicioMes), desde: inicioMes, hasta: hoy },
      b: {
        label: `${mesLabel(inicioMesPrev)} · mismos días`,
        desde: inicioMesPrev,
        hasta: mismoDia > finMesPrev ? finMesPrev : mismoDia,
      },
    };
  }
  return {
    a: { label: 'Últimos 7 días', desde: sumarDias(hoy, -6), hasta: hoy },
    b: { label: '7 días anteriores', desde: sumarDias(hoy, -13), hasta: sumarDias(hoy, -7) },
  };
}

/** Variación porcentual de A respecto a B, 1 decimal. 0 si falta alguno o B es 0. */
export function variacionPct(a: number | null, b: number | null): number {
  if (a === null || b === null || b === 0) return 0;
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}

/** Lo mínimo de `ContadorDiarioPoint` que necesita `sumarConsumo`. */
export interface DiaContador {
  dia: string;
  delta: number | null;
  muestras: number;
}

/**
 * Suma los deltas diarios del totalizador dentro del rango. `null` si el
 * rango no tiene ningún día con muestras (sin datos ≠ consumo 0).
 */
export function sumarConsumo(dias: DiaContador[], rango: RangoPeriodo): number | null {
  const enRango = dias.filter(
    (d) => d.dia >= rango.desde && d.dia <= rango.hasta && d.muestras > 0,
  );
  if (!enRango.length) return null;
  return enRango.reduce((acc, d) => acc + Number(d.delta ?? 0), 0);
}
