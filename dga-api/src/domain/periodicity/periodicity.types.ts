export type PeriodicityUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface Periodicity {
  sitioId: string;
  every: number;
  unit: PeriodicityUnit;
  lastReportedAt: Date | null;
}

export interface PeriodicityCandidate {
  sitioId: string;
  dueAt: Date;
}
