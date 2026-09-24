/**
 * Fallback de `getDashboardHistory` cuando la ventana acotada de 30 dias no
 * trae filas.
 *
 * Hallazgo del 24-09-2026 (ver comentario de `HISTORY_WINDOW_DAYS` en
 * `../repo.ts`): sin cota temporal sobre `bucket`, TimescaleDB abre los ~140
 * chunks de `equipo_1min` al planificar, aunque la consulta se ejecute en
 * milisegundos. La consulta acotada evita eso para el sitio vivo; un sitio
 * mudo hace semanas (ej. S151) no tiene filas en los ultimos 30 dias y
 * necesita la segunda consulta, sin cota, para no dejar el dashboard vacio.
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

import { getDashboardHistory } from '../repo';
import { query } from '../../../config/dbHelpers';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    time: '2026-09-24T12:00:00.000Z',
    received_at: '2026-09-24T12:00:01.000Z',
    id_serial: '10.0.0.1',
    data: { CAUDAL: 5 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe('getDashboardHistory — sitio vivo (la acotada trae filas)', () => {
  it('no ejecuta la segunda consulta (sin cota)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [makeRow()] } as never);

    const rows = await getDashboardHistory('10.0.0.1', 2200);

    expect(query).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);

    const [, , opts] = vi.mocked(query).mock.calls[0]!;
    expect((opts as { label?: string }).label).toBe('sites__dashboard_history');
  });
});

describe('getDashboardHistory — sitio mudo (la acotada devuelve 0 filas)', () => {
  it('ejecuta la segunda consulta sin cota y devuelve su resultado', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [makeRow({ time: '2026-08-01T00:00:00.000Z' })] } as never);

    const rows = await getDashboardHistory('10.0.0.2', 2200);

    expect(query).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.time).toBe('2026-08-01T00:00:00.000Z');

    const secondCallOpts = vi.mocked(query).mock.calls[1]![2] as { label?: string };
    expect(secondCallOpts.label).toBe('sites__dashboard_history_unbounded');
  });
});
