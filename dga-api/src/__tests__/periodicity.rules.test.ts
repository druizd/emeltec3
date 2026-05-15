import { describe, it, expect } from 'vitest';
import { isDue, intervalMs, selectDueSites } from '../domain/periodicity/periodicity.rules';
import type { Periodicity } from '../domain/periodicity/periodicity.types';

const base: Periodicity = {
  sitioId: 'S01',
  every: 1,
  unit: 'hour',
  lastReportedAt: null,
};

describe('intervalMs', () => {
  it('1 minute = 60_000 ms', () => {
    expect(intervalMs({ every: 1, unit: 'minute' })).toBe(60_000);
  });
  it('2 hours = 7_200_000 ms', () => {
    expect(intervalMs({ every: 2, unit: 'hour' })).toBe(7_200_000);
  });
  it('1 day = 86_400_000 ms', () => {
    expect(intervalMs({ every: 1, unit: 'day' })).toBe(86_400_000);
  });
});

describe('isDue', () => {
  it('null lastReportedAt → siempre pendiente', () => {
    expect(isDue({ ...base, lastReportedAt: null })).toBe(true);
  });

  it('reporte reciente (hace 30 min, cadencia 1h) → NO vencido', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const lastReportedAt = new Date('2026-05-14T11:30:00Z');
    expect(isDue({ ...base, unit: 'hour', every: 1, lastReportedAt }, now)).toBe(false);
  });

  it('reporte hace exactamente 1h → vencido (>=)', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const lastReportedAt = new Date('2026-05-14T11:00:00Z');
    expect(isDue({ ...base, unit: 'hour', every: 1, lastReportedAt }, now)).toBe(true);
  });

  it('reporte hace 90 min (cadencia 1h) → vencido', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const lastReportedAt = new Date('2026-05-14T10:30:00Z');
    expect(isDue({ ...base, unit: 'hour', every: 1, lastReportedAt }, now)).toBe(true);
  });

  it('cadencia diaria, reporte hace 12h → NO vencido', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const lastReportedAt = new Date('2026-05-14T00:00:00Z');
    expect(isDue({ ...base, unit: 'day', every: 1, lastReportedAt }, now)).toBe(false);
  });

  it('cadencia diaria, reporte hace 25h → vencido', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const lastReportedAt = new Date('2026-05-13T11:00:00Z');
    expect(isDue({ ...base, unit: 'day', every: 1, lastReportedAt }, now)).toBe(true);
  });
});

describe('selectDueSites', () => {
  const now = new Date('2026-05-14T12:00:00Z');

  it('lista vacía → retorna vacío', () => {
    expect(selectDueSites([], now)).toEqual([]);
  });

  it('solo retorna sitios vencidos', () => {
    const due: Periodicity = { sitioId: 'S01', every: 1, unit: 'hour', lastReportedAt: null };
    const notDue: Periodicity = {
      sitioId: 'S02',
      every: 1,
      unit: 'hour',
      lastReportedAt: new Date('2026-05-14T11:30:00Z'),
    };
    const result = selectDueSites([due, notDue], now);
    expect(result).toHaveLength(1);
    expect(result[0]!.sitioId).toBe('S01');
    expect(result[0]!.dueAt).toBe(now);
  });

  it('retorna todos si todos están vencidos', () => {
    const periodicities: Periodicity[] = [
      { sitioId: 'A', every: 1, unit: 'hour', lastReportedAt: null },
      { sitioId: 'B', every: 1, unit: 'hour', lastReportedAt: null },
    ];
    expect(selectDueSites(periodicities, now)).toHaveLength(2);
  });
});
