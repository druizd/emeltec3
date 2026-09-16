/**
 * Contadores sobre un mes PARTIDO por un cambio de escala.
 *
 * S148 (Weir Esco / Elecmetal, Pozo Colina) venía totalizando en 0,01 m3 y en
 * julio 2026 se rectificó el medidor a m3. `reg_map` tenía un solo `factor` por
 * variable para toda la historia, así que corregirlo arreglaba un tramo y rompía
 * el otro: el histórico quedó inflado 100x — ~100.000 m3/mes contra ~950 reales.
 *
 * La salida es que convivan DOS filas de `reg_map` para la misma variable
 * física, con ventanas disjuntas. Cada una calcula el mes viendo solo sus
 * propios buckets, y `aggregateCounterRows` suma las dos filas resultantes —
 * que es lo que ya hacía para los recambios de equipo.
 *
 * Todos los mocks son completos (mock parcial + importOriginal rompe con los
 * módulos de infraestructura, que tienen side effects al importarse).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks de infraestructura ──────────────────────────────────────────────────

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/redis', () => ({
  cache: { enabled: false, get: vi.fn(), set: vi.fn() },
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

const monthRows: { time: string; data: Record<string, unknown> }[] = [];
let prevRow: { bucket: string; data: Record<string, unknown> } | null = null;

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async (_text: unknown, _values: unknown, opts: { label?: string } = {}) => {
    if (opts.label === 'contadores__month_rows') return { rows: monthRows };
    if (opts.label === 'contadores__prev_month_last') {
      return { rows: prevRow ? [prevRow] : [] };
    }
    return { rows: [] };
  }),
}));

// ── Imports (después de los mocks) ─────────────────────────────────────────────

import { computeMonthDeltaForVariable } from '../service';
import type { RegMap } from '../../sites/types';

/** Instante de la rectificación en terreno. */
const CORTE = '2026-07-12T14:30:00.000Z';

function mapeo(over: Partial<RegMap>): RegMap {
  return {
    id: 'RM-BASE',
    alias: 'Totalizador',
    d1: 'REG4',
    d2: null,
    tipo_dato: 'INTEGER',
    unidad: 'm3',
    rol_dashboard: 'totalizador',
    transformacion: 'lineal',
    parametros: { factor: 1, offset: 0 },
    sitio_id: 'S148',
    vigente_desde: null,
    vigente_hasta: null,
    ...over,
  } as RegMap;
}

/** El medidor viejo contaba en 0,01 m3: 100.000 cuentas son 1.000 m3. */
const VIEJO = mapeo({
  id: 'RM-VIEJO',
  parametros: { factor: 0.01, offset: 0 },
  vigente_hasta: CORTE,
});

/** Tras la rectificación cuenta en m3 y arranca de su propio acumulado. */
const NUEVO = mapeo({
  id: 'RM-NUEVO',
  parametros: { factor: 1, offset: 0 },
  vigente_desde: CORTE,
});

const JULIO = new Date('2026-07-15T00:00:00-04:00');

beforeEach(() => {
  monthRows.length = 0;
  prevRow = null;
  // Julio 2026, a ambos lados del corte. En cuentas crudas: el tramo viejo sube
  // 10.000 cuentas (= 100 m3 a factor 0,01) y el nuevo sube 50 (= 50 m3).
  monthRows.push(
    { time: '2026-07-05T12:00:00.000Z', data: { REG4: 100_000 } },
    { time: '2026-07-10T12:00:00.000Z', data: { REG4: 110_000 } },
    { time: '2026-07-20T12:00:00.000Z', data: { REG4: 1_150 } },
    { time: '2026-07-28T12:00:00.000Z', data: { REG4: 1_200 } },
  );
});

describe('computeMonthDeltaForVariable con ventana de vigencia', () => {
  it('el mapeo viejo solo cuenta sus propios buckets y los escala a m3', async () => {
    const r = await computeMonthDeltaForVariable({
      idSerial: '151.21.49.126',
      mapping: VIEJO,
      pozoConfig: null,
      ...rangoJulio(),
    });

    expect(r.muestras).toBe(2);
    expect(r.valor_inicio).toBe(1000);
    expect(r.valor_fin).toBe(1100);
    expect(r.delta).toBe(100);
    // Los buckets del otro lado del corte valen ~1.150 m3 a factor 0,01: si se
    // colaran, el algoritmo los leería como un retroceso brutal del contador.
    expect(r.resets_detectados).toBe(0);
  });

  it('el mapeo nuevo solo cuenta los suyos, sin arrastrar el salto del corte', async () => {
    const r = await computeMonthDeltaForVariable({
      idSerial: '151.21.49.126',
      mapping: NUEVO,
      pozoConfig: null,
      ...rangoJulio(),
    });

    expect(r.muestras).toBe(2);
    expect(r.valor_inicio).toBe(1150);
    expect(r.valor_fin).toBe(1200);
    expect(r.delta).toBe(50);
    expect(r.resets_detectados).toBe(0);
  });

  it('las dos mitades suman el consumo real del mes partido', async () => {
    const viejo = await computeMonthDeltaForVariable({
      idSerial: '151.21.49.126',
      mapping: VIEJO,
      pozoConfig: null,
      ...rangoJulio(),
    });
    const nuevo = await computeMonthDeltaForVariable({
      idSerial: '151.21.49.126',
      mapping: NUEVO,
      pozoConfig: null,
      ...rangoJulio(),
    });

    // 150 m3, que es lo que `aggregateCounterRows` va a mostrar en el chart.
    expect((viejo.delta ?? 0) + (nuevo.delta ?? 0)).toBe(150);
  });

  it('sin ventanas un solo mapeo pierde el tramo posterior al corte', async () => {
    // El estado anterior a la migración, y el motivo del bug: un único mapeo ve
    // las 4 muestras y el desplome del corte queda como un dip que no alcanza a
    // confirmarse (RESET_CONFIRM_SAMPLES = 10, y después del corte solo hay 2
    // muestras), así que `filterTransientDips` se come el tramo nuevo entero.
    // El mes cierra en 100 m3 cuando el consumo real fue 150.
    const r = await computeMonthDeltaForVariable({
      idSerial: '151.21.49.126',
      mapping: mapeo({ id: 'RM-SIN-VENTANA', parametros: { factor: 0.01, offset: 0 } }),
      pozoConfig: null,
      ...rangoJulio(),
    });

    expect(r.muestras).toBe(2);
    expect(r.delta).toBe(100);
    expect(r.delta).not.toBe(150);
  });

  it('el seed del mes anterior también respeta la ventana', async () => {
    // La última lectura de junio es del medidor VIEJO: 99.000 cuentas = 990 m3,
    // que continúa la serie del tramo viejo. Si sembrara también al mapeo nuevo,
    // el salto de 990 a 1.150 entraría como consumo que nadie bombeó.
    prevRow = { bucket: '2026-06-30T23:00:00.000Z', data: { REG4: 99_000 } };

    const nuevo = await computeMonthDeltaForVariable({
      idSerial: '151.21.49.126',
      mapping: NUEVO,
      pozoConfig: null,
      ...rangoJulio(),
    });
    expect(nuevo.delta).toBe(50);

    // Al viejo sí le corresponde ese seed: está dentro de su ventana.
    const viejo = await computeMonthDeltaForVariable({
      idSerial: '151.21.49.126',
      mapping: VIEJO,
      pozoConfig: null,
      ...rangoJulio(),
    });
    expect(viejo.valor_inicio).toBe(1000);
  });
});

/** `[start, end)` de julio 2026 en zona Chile, como los arma el servicio. */
function rangoJulio() {
  return {
    start: new Date('2026-07-01T00:00:00-04:00'),
    end: new Date('2026-08-01T00:00:00-04:00'),
    ref: JULIO,
  };
}
