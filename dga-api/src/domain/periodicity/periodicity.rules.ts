// Reglas puras: dado un set de periodicidades, decide qué sitios deben reportar AHORA.
// Sin I/O. El scheduler las invoca cada minuto.
import type { Periodicity, PeriodicityCandidate, PeriodicityUnit } from './periodicity.types';

// Conversión de unidad a milisegundos. Mes y año son aproximados (30d / 365d).
const MS_PER_UNIT: Record<PeriodicityUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

// Convierte (every, unit) → intervalo en ms.
export function intervalMs({ every, unit }: Pick<Periodicity, 'every' | 'unit'>): number {
  return every * MS_PER_UNIT[unit];
}

// ¿Pasó suficiente tiempo desde el último reporte como para emitir uno nuevo?
// Si nunca ha reportado (lastReportedAt=null), siempre está pendiente.
export function isDue(p: Periodicity, now: Date = new Date()): boolean {
  if (!p.lastReportedAt) return true;
  return now.getTime() - p.lastReportedAt.getTime() >= intervalMs(p);
}

// Filtra de una lista de periodicidades aquellas que están vencidas y arma candidatos.
export function selectDueSites(
  periodicities: Periodicity[],
  now: Date = new Date(),
): PeriodicityCandidate[] {
  return periodicities
    .filter((p) => isDue(p, now))
    .map((p) => ({ sitioId: p.sitioId, dueAt: now }));
}
