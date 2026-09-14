/**
 * `computeMonthDeltaForVariable` con muestras corruptas en el crudo.
 *
 * El caso que motiva el archivo: S130 Pozo 4 mostraba el Flujo Mensual en
 * notación científica (5e16 m³) el 14-09-2026. Tres muestras del minuto del
 * recambio traían basura en el registro alto del float:
 *
 *   REG3000=53716 -> 0xD1D4434E -> -9,1e10
 *   REG3000=24453 -> 0x5F85434E -> +1,9e16
 *   REG3000=42755 -> 0xA7034BD8 -> negativo
 *
 * El algoritmo de segmentos las tomaba como saltos o retrocesos reales y
 * contaminaba el mes completo: al cerrar el período suma
 * `valorFin - segmentBase` y con esas bases el delta se va a 1e16.
 *
 * El guard necesita las DOS mitades. Un primer arreglo que sólo miraba el signo
 * dejó pasar la muestra positiva y el gráfico siguió roto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { computeMonthDeltaForVariable } from '../service';
import { query } from '../../../config/dbHelpers';
import type { RegMap } from '../../sites/types';

/** Totalizador `directo`: el valor del payload es el acumulado, sin escalar. */
const MAPPING = {
  id: 'V1',
  alias: 'Totalizador',
  d1: 'TOT',
  d2: null,
  tipo_dato: 'FLOAT',
  unidad: 'm3',
  rol_dashboard: 'totalizador',
  transformacion: 'directo',
  parametros: null,
  sitio_id: 'S130',
} as unknown as RegMap;

const START = new Date('2026-09-01T04:00:00Z');
const END = new Date('2026-10-01T04:00:00Z');

/**
 * El primer `query` del cómputo trae las muestras del mes; el segundo busca el
 * seed cross-month, que acá siempre va vacío para aislar el filtro.
 */
function mockMuestras(valores: (number | null)[]): void {
  const rows = valores.map((v, i) => ({
    time: new Date(START.getTime() + i * 60_000).toISOString(),
    data: v === null ? {} : { TOT: v },
  }));
  vi.mocked(query)
    .mockResolvedValueOnce({ rows } as never)
    .mockResolvedValueOnce({ rows: [] } as never);
}

function computar() {
  return computeMonthDeltaForVariable({
    idSerial: '151.21.35.32',
    mapping: MAPPING,
    pozoConfig: null,
    start: START,
    end: END,
  });
}

describe('computeMonthDeltaForVariable — muestras corruptas', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('una muestra negativa no contamina el delta del mes', async () => {
    // El caso de S130: cuenta normal, basura del datalogger, cuenta normal.
    mockMuestras([28_395, 28_500, -69_000_000_000, 28_600, 44_652]);
    const r = await computar();

    expect(r.delta).toBeCloseTo(16_257, 0);
    expect(r.valor_inicio).toBe(28_395);
    expect(r.valor_fin).toBe(44_652);
    // La muestra corrupta no se cuenta ni como muestra ni como reset.
    expect(r.muestras).toBe(4);
    expect(r.resets_detectados).toBe(0);
  });

  it('sin el filtro el mes se iría a un orden de magnitud absurdo', async () => {
    // Guard de regresión: verifica la MAGNITUD, que es lo que se veía en el
    // gráfico. Si alguien quita el filtro, este número explota a ~7e10.
    mockMuestras([28_395, -69_000_000_000, 44_652]);
    const r = await computar();
    expect(r.delta).toBeLessThan(1_000_000);
  });

  it('varias muestras corruptas seguidas tampoco pasan', async () => {
    // En S130 fueron tres, todas el mismo minuto.
    mockMuestras([28_395, -69_000_000_000, -70_000_000_000, -68_000_000_000, 44_652]);
    const r = await computar();
    expect(r.delta).toBeCloseTo(16_257, 0);
    expect(r.muestras).toBe(2);
  });

  it('una muestra POSITIVA astronómica tampoco pasa', async () => {
    // El caso que se escapó del primer intento de arreglo: en S130 el registro
    // alto corrupto (REG3000=24453 -> 0x5F85434E) daba +1,9e16 con el bit de
    // signo en 0, así que un guard que sólo mirara el signo lo dejaba pasar.
    mockMuestras([28_395, 1.9e16, 44_652]);
    const r = await computar();

    expect(r.delta).toBeCloseTo(16_257, 0);
    expect(r.valor_fin).toBe(44_652);
    expect(r.muestras).toBe(2);
    expect(r.resets_detectados).toBe(0);
  });

  it('las dos mitades del guard actúan sobre la misma serie', async () => {
    // Reproduce el trío exacto de S130: negativo, positivo astronómico,
    // negativo — los tres en el minuto del recambio.
    mockMuestras([28_395, -9.1e10, 1.9e16, -8.0e10, 44_652]);
    const r = await computar();

    expect(r.delta).toBeCloseTo(16_257, 0);
    expect(r.muestras).toBe(2);
    expect(r.resets_detectados).toBe(0);
  });

  it('una cuenta POSITIVA pequeña sí entra: el filtro es sólo para lo imposible', async () => {
    // La diferencia que importa. Un contador recién re-baseado marca valores
    // chicos y eso es dato; un -7e10 no es una cuenta chica, es basura.
    mockMuestras([1, 2, 3]);
    const r = await computar();

    expect(r.muestras).toBe(3);
    expect(r.valor_inicio).toBe(1);
    expect(r.valor_fin).toBe(3);
    expect(r.delta).toBeCloseTo(2, 0);
  });

  it('el 0 lo descarta isZeroPayload, antes de llegar a este filtro', async () => {
    // Comportamiento preexistente que conviene dejar documentado: un payload
    // con el registro en 0 se considera lectura ausente, no un acumulado de
    // cero. Por eso valor_inicio es la primera muestra distinta de 0.
    mockMuestras([0, 100, 250]);
    const r = await computar();
    expect(r.valor_inicio).toBe(100);
    expect(r.muestras).toBe(2);
    expect(r.delta).toBeCloseTo(150, 0);
  });
});
