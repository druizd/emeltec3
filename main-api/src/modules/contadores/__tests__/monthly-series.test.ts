/**
 * Tests de getMonthlySeries — la serie que alimenta el chart "Flujo Mensual".
 *
 * El caso que motiva el archivo: S128 Pozo 1 (OB-0601-444) mostraba agosto 2026
 * en blanco teniendo 11.886 m3 medidos. Al recambiar el caudalímetro el mapeo
 * nuevo entró con `rol_dashboard='totalizador'` y el viejo se degradó a
 * `generico`, pero las filas ya escritas de `site_contador_mensual` conservan su
 * `rol` congelado. El mes anterior quedó entonces con DOS filas — la real del
 * equipo retirado y una vacía que el worker escribió para el equipo nuevo,
 * cuyos registros no existían ese mes — y la lectura las colapsaba con
 * `map.set(mes, fila)`: ganaba la última que devolvía Postgres, en un orden que
 * no está garantizado.
 *
 * Todos los mocks son completos (mock parcial + importOriginal rompe con los
 * módulos de infraestructura, que tienen side effects al importarse).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  listContadoresBySiteAndRol: vi.fn(async () => []),
  listCounterVariablesForSiteAndRol: vi.fn(async () => []),
  listCounterVariablesForSite: vi.fn(async () => []),
  listCounterVariables: vi.fn(async () => []),
  getMappingsBySiteId: vi.fn(async () => []),
  getSiteById: vi.fn(async () => null),
  upsertContadorMensual: vi.fn(async () => undefined),
}));

vi.mock('../../sites/repo', () => ({
  getPozoConfigBySiteId: vi.fn(async () => null),
  getDashboardBucketExact: vi.fn(async () => null),
}));

vi.mock('../daily-repo', () => ({
  listContadorDiarioBySiteRolDias: vi.fn(async () => []),
  listContadorJornadaBySiteRolDias: vi.fn(async () => []),
  diaToIso: vi.fn((dia: unknown) => String(dia).slice(0, 10)),
}));

// ── Imports (después de los mocks) ─────────────────────────────────────────────
import { getMonthlySeries } from '../service';
import { listContadoresBySiteAndRol, listCounterVariablesForSiteAndRol } from '../repo';

// Fijamos el reloj: la serie se arma con `lastNMonths(n)` relativo a "ahora",
// así los meses del test son estables.
const AHORA = new Date('2026-09-07T12:00:00Z');
const RECIENTE = new Date('2026-09-07T11:45:00Z').toISOString();

function makeMensualRow(mes: string, overrides: Record<string, unknown> = {}) {
  return {
    sitio_id: 'S128',
    variable_id: 'V_VIEJO',
    rol: 'totalizador',
    mes,
    valor_inicio: 0,
    valor_fin: 0,
    delta: 0,
    unidad: 'm3',
    muestras: 0,
    resets_detectados: 0,
    ultimo_dato: null,
    actualizado_at: RECIENTE,
    ...overrides,
  };
}

function mesDe<T extends { mes: string }>(series: T[], mes: string): T {
  const point = series.find((p) => p.mes === mes);
  if (!point) throw new Error(`la serie no trae ${mes}: ${series.map((p) => p.mes).join(', ')}`);
  return point;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getMonthlySeries — recambio de caudalímetro', () => {
  it('la fila vacía del equipo nuevo no tapa la real del retirado', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      // Equipo retirado: midió agosto completo.
      makeMensualRow('2026-08-01', {
        variable_id: 'V_VIEJO',
        delta: 11886,
        muestras: 44574,
        ultimo_dato: '2026-09-01T03:59:00.000Z',
      }),
      // Equipo nuevo: el worker le escribió agosto porque el mes seguía dentro
      // de la ventana de refresco del cagg, pero sus registros no existían.
      makeMensualRow('2026-08-01', { variable_id: 'V_NUEVO', delta: null, muestras: 0 }),
      // Mes actual, para que el refresh lazy no se dispare.
      makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1026.9, muestras: 5597 }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    const agosto = mesDe(series, '2026-08-01');
    expect(agosto.delta).toBe(11886);
    expect(agosto.muestras).toBe(44574);
    expect(agosto.unidad).toBe('m3');
  });

  it('el orden en que Postgres devuelve las filas no cambia el resultado', async () => {
    const real = makeMensualRow('2026-08-01', {
      variable_id: 'V_VIEJO',
      delta: 11886,
      muestras: 44574,
    });
    const vacia = makeMensualRow('2026-08-01', {
      variable_id: 'V_NUEVO',
      delta: null,
      muestras: 0,
    });
    const mesActual = makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1 });

    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([real, vacia, mesActual]);
    const enUnOrden = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([vacia, real, mesActual]);
    const enElOtro = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    expect(mesDe(enUnOrden, '2026-08-01').delta).toBe(11886);
    expect(mesDe(enElOtro, '2026-08-01').delta).toBe(11886);
  });

  it('suma los dos equipos en el mes del recambio', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      // El viejo midió del 1 al 4, el nuevo del 4 en adelante.
      makeMensualRow('2026-09-01', { variable_id: 'V_VIEJO', delta: 400, muestras: 5000 }),
      makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1026.9, muestras: 5597 }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    const septiembre = mesDe(series, '2026-09-01');
    expect(septiembre.delta).toBeCloseTo(1426.9, 6);
    expect(septiembre.muestras).toBe(10597);
  });

  it('suma los resets y se queda con el ultimo_dato más nuevo', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      makeMensualRow('2026-09-01', {
        variable_id: 'V_VIEJO',
        delta: 400,
        resets_detectados: 1,
        ultimo_dato: '2026-09-04T14:00:00.000Z',
      }),
      makeMensualRow('2026-09-01', {
        variable_id: 'V_NUEVO',
        delta: 1000,
        resets_detectados: 2,
        ultimo_dato: '2026-09-07T02:19:00.000Z',
      }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    const septiembre = mesDe(series, '2026-09-01');
    expect(septiembre.resets_detectados).toBe(3);
    expect(septiembre.ultimo_dato).toBe('2026-09-07T02:19:00.000Z');
  });

  it('no suma unidades distintas: gana la fila con más muestras', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      makeMensualRow('2026-08-01', { variable_id: 'V_VIEJO', delta: 11886, muestras: 44574 }),
      makeMensualRow('2026-08-01', {
        variable_id: 'V_NUEVO',
        delta: 500000,
        muestras: 12,
        unidad: 'L',
      }),
      makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1 }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    const agosto = mesDe(series, '2026-08-01');
    expect(agosto.delta).toBe(11886);
    expect(agosto.unidad).toBe('m3');
  });
});

describe('getMonthlySeries — huecos', () => {
  it('un mes sin ninguna fila queda en null, no en cero', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1026.9, muestras: 5597 }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    expect(mesDe(series, '2026-07-01').delta).toBeNull();
    expect(mesDe(series, '2026-07-01').muestras).toBe(0);
  });

  it('un mes con filas pero todas sin dato también queda en null', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      makeMensualRow('2026-08-01', { variable_id: 'V_VIEJO', delta: null, muestras: 0 }),
      makeMensualRow('2026-08-01', { variable_id: 'V_NUEVO', delta: null, muestras: 0 }),
      makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1 }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    expect(mesDe(series, '2026-08-01').delta).toBeNull();
  });

  it('devuelve exactamente `meses` puntos, en orden ascendente', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1 }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    expect(series).toHaveLength(12);
    expect(series[0]!.mes).toBe('2025-10-01');
    expect(series[11]!.mes).toBe('2026-09-01');
    expect(series.map((p) => p.mes)).toEqual([...series.map((p) => p.mes)].sort());
  });
});

describe('getMonthlySeries — refresh lazy del mes actual', () => {
  it('no recomputa si alguna fila del mes actual está fresca', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      // La del equipo retirado quedó congelada en el recambio...
      makeMensualRow('2026-09-01', {
        variable_id: 'V_VIEJO',
        delta: 400,
        actualizado_at: '2026-09-04T12:00:00.000Z',
      }),
      // ...pero la del vigente la refrescó el worker hace 15 minutos.
      makeMensualRow('2026-09-01', { variable_id: 'V_NUEVO', delta: 1026.9 }),
    ]);

    await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    expect(listCounterVariablesForSiteAndRol).not.toHaveBeenCalled();
  });

  it('recomputa si falta la fila del mes actual', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      makeMensualRow('2026-08-01', { variable_id: 'V_VIEJO', delta: 11886, muestras: 44574 }),
    ]);

    const series = await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    expect(listCounterVariablesForSiteAndRol).toHaveBeenCalledWith('S128', 'totalizador');
    // Sin variables que recomputar el refresh devuelve 0 y se sirven las filas
    // viejas tal cual.
    expect(mesDe(series, '2026-08-01').delta).toBe(11886);
  });

  it('recomputa si todas las filas del mes actual están stale (>1h)', async () => {
    vi.mocked(listContadoresBySiteAndRol).mockResolvedValue([
      makeMensualRow('2026-09-01', {
        variable_id: 'V_NUEVO',
        delta: 1026.9,
        actualizado_at: '2026-09-07T09:00:00.000Z',
      }),
    ]);

    await getMonthlySeries({ sitioId: 'S128', rol: 'totalizador', meses: 12 });

    expect(listCounterVariablesForSiteAndRol).toHaveBeenCalledWith('S128', 'totalizador');
  });
});
