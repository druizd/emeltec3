/**
 * Tests del módulo periodComparison.
 *
 * Las funciones de fechas y acumulación se prueban puras. `compararPeriodos`
 * se prueba con la DB y el módulo contadores mockeados por completo (mismo
 * patrón que contadores/__tests__/daily-fallback.test.ts): lo que interesa es
 * que una sola consulta a equipo_5min cubra A y B, que las filas se repartan
 * por día Chile y que el consumo se apague cuando el rango excede los 120 días.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoricalCell, Site } from '../../sites/types';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/redis', () => ({
  cache: { enabled: false, get: vi.fn(), set: vi.fn() },
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

const queryMock = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[] }));
vi.mock('../../../config/dbHelpers', () => ({
  query: (sql: string, params?: unknown[]) => queryMock(sql, params),
}));

vi.mock('../../sites/repo', () => ({
  getMappingsBySiteId: vi.fn(async () => []),
  getPozoConfigBySiteId: vi.fn(async () => null),
}));

// El mapper real necesita mappings reales; acá devolvemos celdas fijas por
// fila para verificar solo el reparto por rango y los promedios.
vi.mock('../../sites/service', () => ({
  mapHistoricalDashboardRow: vi.fn(({ row }: { row: { data: Record<string, unknown> } }) => {
    const d = row.data as { caudal?: number; nivel?: number; freatico?: number | null };
    const cell = (v: number | null | undefined, unidad: string): HistoricalCell =>
      v === null || v === undefined
        ? { ok: false, valor: null, unidad, alias: null }
        : { ok: true, valor: v, unidad, alias: null };
    return {
      timestamp: null,
      fecha: null,
      received_at: null,
      caudal: cell(d.caudal, 'L/s'),
      nivel: cell(d.nivel, 'm'),
      totalizador: cell(null, 'm3'),
      nivel_freatico: cell(d.freatico, 'm'),
    };
  }),
}));

const getDailySeriesMock = vi.fn(async (_opts: { sitioId: string; rol: string; dias: number }) => [
  {
    dia: '2026-08-24',
    delta: 100,
    unidad: 'm3',
    muestras: 288,
    ultimo_dato: null,
    resets_detectados: 0,
  },
  {
    dia: '2026-08-31',
    delta: 40,
    unidad: 'm3',
    muestras: 288,
    ultimo_dato: null,
    resets_detectados: 0,
  },
  {
    dia: '2026-09-01',
    delta: null,
    unidad: 'm3',
    muestras: 12,
    ultimo_dato: null,
    resets_detectados: 0,
  },
  {
    dia: '2026-09-02',
    delta: 99,
    unidad: 'm3',
    muestras: 0,
    ultimo_dato: null,
    resets_detectados: 0,
  },
  {
    dia: '2026-09-03',
    delta: 5,
    unidad: 'm3',
    muestras: 288,
    ultimo_dato: null,
    resets_detectados: 0,
  },
]);
vi.mock('../../contadores/service', () => ({
  // Día Chile a partir del ISO UTC: solo desplazamos -4 h, suficiente para el test.
  chileDayKey: (d: Date) => new Date(d.getTime() - 4 * 3_600_000).toISOString().slice(0, 10),
  getDailySeries: (opts: { sitioId: string; rol: string; dias: number }) =>
    getDailySeriesMock(opts),
}));

import {
  MAX_DIAS_CONTADORES,
  acumularAgregados,
  compararPeriodos,
  diasCoberturaContadores,
  diasInclusivos,
  sumarConsumo,
  type FilaHistorica,
} from '../service';

const site = (overrides: Partial<Site> = {}): Site => ({
  id: 'S1',
  descripcion: 'Pozo 1',
  empresa_id: 'E1',
  sub_empresa_id: 'SE1',
  id_serial: '151.20.1.1',
  ubicacion: null,
  tipo_sitio: 'pozo',
  activo: true,
  ...overrides,
});

const celda = (v: number | null, unidad: string): HistoricalCell =>
  v === null
    ? { ok: false, valor: null, unidad, alias: null }
    : { ok: true, valor: v, unidad, alias: null };

const fila = (
  dia: string,
  caudal: number | null,
  nivel: number | null,
  freatico: number | null,
): FilaHistorica => ({
  dia,
  caudal: celda(caudal, 'L/s'),
  nivel: celda(nivel, 'm'),
  nivel_freatico: celda(freatico, 'm'),
});

const A = { desde: '2026-08-31', hasta: '2026-09-03' };
const B = { desde: '2026-08-24', hasta: '2026-08-27' };

describe('periodComparison · fechas', () => {
  it('diasInclusivos cuenta ambos extremos', () => {
    expect(diasInclusivos('2026-09-01', '2026-09-03')).toBe(3);
    expect(diasInclusivos('2026-09-03', '2026-09-03')).toBe(1);
  });

  it('diasCoberturaContadores va desde el "desde" más antiguo hasta hoy', () => {
    expect(diasCoberturaContadores([A, B], '2026-09-03')).toBe(11);
  });

  it('diasCoberturaContadores es null si excede el tope del endpoint de contadores', () => {
    const viejo = { desde: '2026-01-01', hasta: '2026-01-31' };
    expect(diasInclusivos(viejo.desde, '2026-09-03')).toBeGreaterThan(MAX_DIAS_CONTADORES);
    expect(diasCoberturaContadores([A, viejo], '2026-09-03')).toBeNull();
  });
});

describe('periodComparison · acumularAgregados', () => {
  it('promedia solo las filas del rango e ignora celdas sin dato', () => {
    const filas = [
      fila('2026-08-30', 99, 99, 99), // fuera de A
      fila('2026-08-31', 10, 50, 40),
      fila('2026-09-01', 20, 52, null), // freático sin dato: no cuenta
      fila('2026-09-03', null, 54, 44), // caudal sin dato
    ];
    const r = acumularAgregados(filas, A);
    expect(r.caudal).toEqual({ avg: 15, n: 2, unidad: 'L/s' });
    expect(r.nivel).toEqual({ avg: 42, n: 2, unidad: 'm' });
  });

  it('cae al nivel crudo cuando el rango no tiene ninguna muestra freática', () => {
    const filas = [fila('2026-08-31', 1, 60, null), fila('2026-09-01', 1, 62, null)];
    expect(acumularAgregados(filas, A).nivel).toEqual({ avg: 61, n: 2, unidad: 'm' });
  });

  it('devuelve null/0 cuando no hay filas en el rango', () => {
    const r = acumularAgregados([fila('2026-08-01', 1, 1, 1)], A);
    expect(r.caudal).toEqual({ avg: null, n: 0, unidad: null });
    expect(r.nivel).toEqual({ avg: null, n: 0, unidad: null });
  });
});

describe('periodComparison · sumarConsumo', () => {
  const serie = [
    {
      dia: '2026-08-30',
      delta: 100,
      unidad: 'm3',
      muestras: 288,
      ultimo_dato: null,
      resets_detectados: 0,
    },
    {
      dia: '2026-08-31',
      delta: 50,
      unidad: 'm3',
      muestras: 288,
      ultimo_dato: null,
      resets_detectados: 0,
    },
    {
      dia: '2026-09-01',
      delta: null,
      unidad: 'm3',
      muestras: 10,
      ultimo_dato: null,
      resets_detectados: 0,
    },
    {
      dia: '2026-09-02',
      delta: 25,
      unidad: 'm3',
      muestras: 0,
      ultimo_dato: null,
      resets_detectados: 0,
    },
    {
      dia: '2026-09-03',
      delta: 5,
      unidad: 'm3',
      muestras: 288,
      ultimo_dato: null,
      resets_detectados: 0,
    },
  ];

  it('suma los días del rango con muestras; delta null suma 0', () => {
    // 50 (31-08) + 0 (01-09) + 5 (03-09); el 02-09 no tiene muestras.
    expect(sumarConsumo(serie, A)).toEqual({ m3: 55, dias_con_datos: 3, unidad: 'm3' });
  });

  it('m3 null cuando ningún día del rango tiene muestras', () => {
    expect(sumarConsumo(serie, { desde: '2026-09-02', hasta: '2026-09-02' })).toEqual({
      m3: null,
      dias_con_datos: 0,
      unidad: null,
    });
  });
});

describe('periodComparison · compararPeriodos', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getDailySeriesMock.mockClear();
  });

  it('una consulta a equipo_5min por sitio cubre A y B, y reparte las filas por día Chile', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (!sql.includes('equipo_5min')) return { rows: [] };
      return {
        rows: [
          // 2026-08-25 12:00 Chile → B
          {
            time: '2026-08-25T16:00:00.000Z',
            id_serial: '151.20.1.1',
            data: { caudal: 30, nivel: 70, freatico: 60 },
          },
          // 2026-09-01 12:00 Chile → A
          {
            time: '2026-09-01T16:00:00.000Z',
            id_serial: '151.20.1.1',
            data: { caudal: 10, nivel: 72, freatico: 62 },
          },
          // 2026-09-03 12:00 Chile → A
          {
            time: '2026-09-03T16:00:00.000Z',
            id_serial: '151.20.1.1',
            data: { caudal: 20, nivel: 74, freatico: 64 },
          },
        ],
      };
    });

    const r = await compararPeriodos({
      sitios: [site()],
      rangos: { a: A, b: B },
      hoyIso: '2026-09-03',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0]!;
    expect(sql).toContain('equipo_5min');
    expect(sql).toContain(' OR ');
    expect(params).toEqual(['151.20.1.1', A.desde, A.hasta, B.desde, B.hasta]);

    expect(r.consumo_disponible).toBe(true);
    expect(getDailySeriesMock).toHaveBeenCalledWith({
      sitioId: 'S1',
      rol: 'totalizador',
      dias: 11,
    });

    const s = r.sitios[0]!;
    expect(s.site_id).toBe('S1');
    expect(s.caudal.a).toEqual({ avg: 15, n: 2, unidad: 'L/s' });
    expect(s.caudal.b).toEqual({ avg: 30, n: 1, unidad: 'L/s' });
    expect(s.nivel.a).toEqual({ avg: 63, n: 2, unidad: 'm' });
    expect(s.nivel.b).toEqual({ avg: 60, n: 1, unidad: 'm' });
    // A: 40 (31-08) + 0 (01-09 delta null) + 5 (03-09). B: 100 (24-08).
    expect(s.consumo.a).toEqual({ m3: 45, dias_con_datos: 3, unidad: 'm3' });
    expect(s.consumo.b).toEqual({ m3: 100, dias_con_datos: 1, unidad: 'm3' });
  });

  it('sitio sin id_serial: fila vacía sin tocar la DB ni contadores', async () => {
    const r = await compararPeriodos({
      sitios: [site({ id_serial: null })],
      rangos: { a: A, b: B },
      hoyIso: '2026-09-03',
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(getDailySeriesMock).not.toHaveBeenCalled();
    expect(r.sitios[0]!.caudal.a).toEqual({ avg: null, n: 0, unidad: null });
    expect(r.sitios[0]!.consumo.a).toEqual({ m3: null, dias_con_datos: 0, unidad: null });
  });

  it('con un período más viejo que el tope de contadores, apaga el consumo pero mantiene caudal/nivel', async () => {
    queryMock.mockImplementation(async () => ({
      rows: [
        {
          time: '2026-01-10T16:00:00.000Z',
          id_serial: '151.20.1.1',
          data: { caudal: 7, nivel: 1, freatico: 2 },
        },
      ],
    }));
    const viejo = { desde: '2026-01-01', hasta: '2026-01-31' };
    const r = await compararPeriodos({
      sitios: [site()],
      rangos: { a: A, b: viejo },
      hoyIso: '2026-09-03',
    });

    expect(r.consumo_disponible).toBe(false);
    expect(getDailySeriesMock).not.toHaveBeenCalled();
    expect(r.sitios[0]!.caudal.b).toEqual({ avg: 7, n: 1, unidad: 'L/s' });
    expect(r.sitios[0]!.consumo.a).toEqual({ m3: null, dias_con_datos: 0, unidad: null });
  });

  it('procesa varios sitios y conserva el orden de entrada', async () => {
    queryMock.mockImplementation(async () => ({ rows: [] }));
    const sitios = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((id) =>
      site({ id, id_serial: `serial-${id}`, descripcion: `Pozo ${id}` }),
    );
    const r = await compararPeriodos({ sitios, rangos: { a: A, b: B }, hoyIso: '2026-09-03' });
    expect(r.sitios.map((s) => s.site_id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(queryMock).toHaveBeenCalledTimes(6);
  });
});
