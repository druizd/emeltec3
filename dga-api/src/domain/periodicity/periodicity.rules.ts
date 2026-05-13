import type { Periodicity, PeriodicityCandidate, PeriodicityUnit } from './periodicity.types';

const MS_PER_UNIT: Record<PeriodicityUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export function intervalMs({ every, unit }: Pick<Periodicity, 'every' | 'unit'>): number {
  return every * MS_PER_UNIT[unit];
}

export function isDue(p: Periodicity, now: Date = new Date()): boolean {
  if (!p.lastReportedAt) return true;
  return now.getTime() - p.lastReportedAt.getTime() >= intervalMs(p);
}

export function selectDueSites(periodicities: Periodicity[], now: Date = new Date()): PeriodicityCandidate[] {
  return periodicities
    .filter((p) => isDue(p, now))
    .map((p) => ({ sitioId: p.sitioId, dueAt: now }));
}
