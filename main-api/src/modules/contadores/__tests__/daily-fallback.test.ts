/**
 * Tests del patrón de fallback en getDailySeries y getJornadaSeries.
 *
 * El fallback se verifica a través de los mocks de daily-repo:
 * cuando listContadorDiarioBySiteRolDias devuelve un Map vacío (sin filas
 * materializadas), getDailySeries debe llamar a computeDailyDeltasForVariable.
 * Cuando devuelve todas las filas, no debe llamar al cómputo on-demand.
 *
 * Para evitar problemas de mock parcial (vi.mock + importOriginal con módulos
 * que tienen side effects de infraestructura), todos los mocks son completos.
 * Los helpers puros (getDayRangeChile, lastNDays, chileDayKey) se prueban de
 * forma aislada para garantizar que el domain logic es correcto sin DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks de infraestructura ──────────────────────────────────────────────────

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/redis', () => ({
  cache: { enabled: false, get: vi.fn(), set: vi.fn() },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

vi.mock('../../../config/db.js', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test' },
    redis: { enabled: false },
    gcs: { enabled: false },
  },
}));

vi.mock('../../../config/metrics', () => ({
  dbQueryDuration: { observe: vi.fn() },
}));

vi.mock('../repo', () => ({
  listCounterVariablesForSite: vi.fn(async () => []),
  getMappingsBySiteId: vi.fn(async () => []),
  getSiteById: vi.fn(async () => null),
  listContadoresBySiteAndRol: vi.fn(async () => []),
  upsertContadorMensual: vi.fn(async () => undefined),
  listCounterVariables: vi.fn(async () => []),
}));

vi.mock('../../sites/repo', () => ({
  getPozoConfigBySiteId: vi.fn(async () => null),
  getDashboardBucketExact: vi.fn(async () => null),
}));

vi.mock('../daily-repo', () => ({
  listContadorDiarioBySiteRolDias: vi.fn(async () => new Map()),
  listContadorJornadaBySiteRolDias: vi.fn(async () => new Map()),
  diarioRowToPoint: vi.fn((row: Record<string, unknown>, _u: unknown) => ({
    dia: String(row.dia).slice(0, 10),
    delta: row.delta as number | null,
    unidad: row.unidad as string | null,
    muestras: row.muestras as number,
    ultimo_dato: row.ultimo_dato as string | null,
    resets_detectados: row.resets_detectados as number,
  })),
  jornadaRowToPoint: vi.fn((row: Record<string, unknown>, _u: unknown) => ({
    dia: String(row.dia).slice(0, 10),
    inicio: row.inicio as string,
    fin: row.fin as string,
    delta: row.delta as number | null,
    unidad: row.unidad as string | null,
    muestras: row.muestras as number,
    ultimo_dato: row.ultimo_dato as string | null,
    resets_detectados: row.resets_detectados as number,
  })),
}));

// ── Imports (después de los mocks) ─────────────────────────────────────────────
import { listCounterVariablesForSite } from '../repo';
import { listContadorDiarioBySiteRolDias, listContadorJornadaBySiteRolDias } from '../daily-repo';
// Importamos los helpers puros del service (no afectados por mocks de infraestructura).
import { getDayRangeChile, lastNDays, chileDayKey, getMonthRangeChile } from '../service';

// ── Tests de helpers puros (sin IO) ───────────────────────────────────────────

describe('getDayRangeChile — helper puro', () => {
  it('devuelve diaIso en formato YYYY-MM-DD', () => {
    const ref = new Date('2026-07-16T12:00:00Z');
    const { diaIso } = getDayRangeChile(ref);
    expect(diaIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('start y end difieren exactamente 24h', () => {
    const ref = new Date('2026-07-16T12:00:00Z');
    const { start, end } = getDayRangeChile(ref);
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe('lastNDays — helper puro', () => {
  it('devuelve exactamente n días', () => {
    expect(lastNDays(7)).toHaveLength(7);
    expect(lastNDays(30)).toHaveLength(30);
  });

  it('el último día es el día actual (hoy)', () => {
    const days = lastNDays(3);
    const lastDay = days[days.length - 1]!;
    const todayIso = getDayRangeChile(new Date()).diaIso;
    const lastIso = getDayRangeChile(lastDay).diaIso;
    expect(lastIso).toBe(todayIso);
  });

  it('los días están en orden ascendente', () => {
    const days = lastNDays(5);
    const isos = days.map((d) => getDayRangeChile(d).diaIso);
    const sorted = [...isos].sort();
    expect(isos).toEqual(sorted);
  });
});

describe('chileDayKey — helper puro', () => {
  it('devuelve una clave de día en formato YYYY-MM-DD', () => {
    const key = chileDayKey(new Date('2026-07-16T12:00:00Z'));
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getMonthRangeChile — helper puro', () => {
  it('devuelve mesIso con día 01', () => {
    const ref = new Date('2026-07-16T12:00:00Z');
    const { mesIso } = getMonthRangeChile(ref);
    expect(mesIso).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('start es anterior a end', () => {
    const ref = new Date('2026-07-16T12:00:00Z');
    const { start, end } = getMonthRangeChile(ref);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
});

// ── Tests de fallback mediante comportamiento observable ───────────────────────
//
// Verificamos que:
// 1. Cuando listContadorDiarioBySiteRolDias devuelve todas las filas → getDailySeries
//    NO llama getMappingsBySiteId (indicador de que NO entra al fallback).
// 2. Cuando NO hay filas materializadas → getDailySeries SÍ intenta cargar mappings
//    (indicador de que entra al fallback).
//
// Este enfoque es más robusto que mockear parcialmente el service porque solo
// observa comportamiento externo (qué funciones DB se llamaron), no internals.

import { getDailySeries, getJornadaSeries } from '../service';
import { getMappingsBySiteId } from '../repo';

function makeCounter() {
  return {
    sitio_id: 'S1', id_serial: '10.0.0.1', variable_id: 'V1',
    alias: 'vol', rol: 'totalizador', unidad: 'm3',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getDailySeries — fast path: todos los días materializados', () => {
  it('no consulta mappings (no entra al fallback) cuando todas las filas existen', async () => {
    vi.mocked(listCounterVariablesForSite).mockResolvedValue([makeCounter()]);

    const days = lastNDays(2);
    const diaIsos = days.map((d) => getDayRangeChile(d).diaIso);
    const matMap = new Map(
      diaIsos.map((iso) => [iso, {
        sitio_id: 'S1', variable_id: 'V1', rol: 'totalizador', dia: iso,
        valor_inicio: 0, valor_fin: 100, delta: 100, unidad: 'm3',
        muestras: 288, resets_detectados: 0, ultimo_dato: null, actualizado_at: '',
      }]),
    );
    vi.mocked(listContadorDiarioBySiteRolDias).mockResolvedValue(matMap);

    const series = await getDailySeries({ sitioId: 'S1', rol: 'totalizador', dias: 2 });

    // Fast path: no debería consultar mappings (solo se usa en el fallback).
    expect(getMappingsBySiteId).not.toHaveBeenCalled();
    expect(series).toHaveLength(2);
    // Los puntos vienen de diarioRowToPoint (mockeado).
    expect(series.every((p) => p.delta === 100)).toBe(true);
  });
});

describe('getDailySeries — fallback: sin filas materializadas', () => {
  it('consulta mappings (intenta el fallback) cuando no hay filas materializadas', async () => {
    vi.mocked(listCounterVariablesForSite).mockResolvedValue([makeCounter()]);
    // Sin filas materializadas → missingDays = todos los días.
    vi.mocked(listContadorDiarioBySiteRolDias).mockResolvedValue(new Map());
    // getMappingsBySiteId devuelve vacío (no hay mapping) → el fallback no lanza.
    vi.mocked(getMappingsBySiteId).mockResolvedValue([]);

    const series = await getDailySeries({ sitioId: 'S1', rol: 'totalizador', dias: 2 });

    // El fallback debería intentar cargar los mappings.
    expect(getMappingsBySiteId).toHaveBeenCalledTimes(1);
    // Sin mapping encontrado → serie vacía con delta null.
    expect(series).toHaveLength(2);
    expect(series.every((p) => p.delta === null)).toBe(true);
  });
});

describe('getDailySeries — sin contador para el rol', () => {
  it('devuelve serie vacía sin consultar nada más', async () => {
    vi.mocked(listCounterVariablesForSite).mockResolvedValue([]);

    const series = await getDailySeries({ sitioId: 'S1', rol: 'totalizador', dias: 3 });

    expect(listContadorDiarioBySiteRolDias).not.toHaveBeenCalled();
    expect(getMappingsBySiteId).not.toHaveBeenCalled();
    expect(series).toHaveLength(3);
    expect(series.every((p) => p.delta === null)).toBe(true);
  });
});

describe('getJornadaSeries — fast path: todos los días materializados', () => {
  it('no consulta mappings (no entra al fallback) cuando todas las filas existen', async () => {
    vi.mocked(listCounterVariablesForSite).mockResolvedValue([makeCounter()]);

    const days = lastNDays(2);
    const diaIsos = days.map((d) => getDayRangeChile(d).diaIso);
    const matMap = new Map(
      diaIsos.map((iso) => [iso, {
        sitio_id: 'S1', variable_id: 'V1', rol: 'totalizador', dia: iso,
        inicio: '07:00', fin: '19:00', valor_inicio: 0, valor_fin: 80, delta: 80, unidad: 'm3',
        muestras: 144, resets_detectados: 0, ultimo_dato: null, actualizado_at: '',
      }]),
    );
    vi.mocked(listContadorJornadaBySiteRolDias).mockResolvedValue(matMap);

    const series = await getJornadaSeries({ sitioId: 'S1', rol: 'totalizador', dias: 2, inicio: '07:00', fin: '19:00' });

    expect(getMappingsBySiteId).not.toHaveBeenCalled();
    expect(series).toHaveLength(2);
    expect(series.every((p) => p.delta === 80)).toBe(true);
  });
});

describe('getJornadaSeries — fallback: sin filas materializadas', () => {
  it('consulta mappings (intenta el fallback) cuando no hay filas de jornada', async () => {
    vi.mocked(listCounterVariablesForSite).mockResolvedValue([makeCounter()]);
    vi.mocked(listContadorJornadaBySiteRolDias).mockResolvedValue(new Map());
    vi.mocked(getMappingsBySiteId).mockResolvedValue([]);

    const series = await getJornadaSeries({ sitioId: 'S1', rol: 'totalizador', dias: 2, inicio: '07:00', fin: '19:00' });

    expect(getMappingsBySiteId).toHaveBeenCalledTimes(1);
    expect(series).toHaveLength(2);
    expect(series.every((p) => p.delta === null)).toBe(true);
  });
});

describe('getJornadaSeries — sin contador', () => {
  it('devuelve serie vacía sin consultar nada más', async () => {
    vi.mocked(listCounterVariablesForSite).mockResolvedValue([]);

    const series = await getJornadaSeries({ sitioId: 'S1', rol: 'totalizador', dias: 2, inicio: '07:00', fin: '19:00' });

    expect(listContadorJornadaBySiteRolDias).not.toHaveBeenCalled();
    expect(series).toHaveLength(2);
    expect(series.every((p) => p.delta === null)).toBe(true);
  });
});
