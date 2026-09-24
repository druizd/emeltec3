/**
 * Fallback en dos pasadas de `attachLastSeenToSites` contra `equipo_1min`.
 *
 * Mismo hallazgo que `sites/repo.ts::getDashboardHistory` (24-09-2026): sin
 * cota sobre `bucket`, TimescaleDB abre los ~140 chunks del hypertable/cagg
 * al planificar. Esta consulta en particular fue la que dejo la web sin
 * listado de instalaciones (moria por statement_timeout a los 10s). La
 * primera pasada acotada a 30 dias resuelve los sitios vivos; solo los
 * seriales que no resolvieron ahi (sitios mudos hace semanas) disparan la
 * segunda pasada, sin cota, y unicamente para esos seriales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

import { attachLastSeenToSites } from '../repo';
import { query } from '../../../config/dbHelpers';

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe('attachLastSeenToSites — todos resuelven en la pasada acotada', () => {
  it('no ejecuta la segunda consulta', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { id_serial: 'S1', last_seen: '2026-09-24T12:00:00.000Z' },
        { id_serial: 'S2', last_seen: '2026-09-24T12:01:00.000Z' },
      ],
    } as never);

    const sites = [
      { id: 'a', id_serial: 'S1' },
      { id: 'b', id_serial: 'S2' },
    ];
    const result = await attachLastSeenToSites(sites);

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.find((s) => s.id === 'a')?.last_seen_at).toBe('2026-09-24T12:00:00.000Z');
    expect(result.find((s) => s.id === 'b')?.last_seen_at).toBe('2026-09-24T12:01:00.000Z');

    const firstCallOpts = vi.mocked(query).mock.calls[0]![2] as { name?: string };
    expect(firstCallOpts.name).toBe('companies__last_seen_per_serial');
  });
});

describe('attachLastSeenToSites — algunos seriales no resuelven en la ventana', () => {
  it('deja last_seen_at en null sin una segunda consulta sin cota', async () => {
    // S1 vivo: resuelve en la pasada acotada. S2 mudo hace meses: no aparece
    // ahi y se queda en null. Rescatar su fecha exacta costaba 6,5 s de
    // planificacion y pintaba la misma tarjeta gris "Sin datos" que el null.
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id_serial: 'S1', last_seen: '2026-09-24T12:00:00.000Z' }],
    } as never);

    const sites = [
      { id: 'a', id_serial: 'S1' },
      { id: 'b', id_serial: 'S2' },
    ];
    const result = await attachLastSeenToSites(sites);

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.find((s) => s.id === 'a')?.last_seen_at).toBe('2026-09-24T12:00:00.000Z');
    expect(result.find((s) => s.id === 'b')?.last_seen_at).toBeNull();
  });

  it('no ejecuta una segunda pasada vacia cuando no hay faltantes', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    const sites = [{ id: 'a', id_serial: null }];
    await attachLastSeenToSites(sites);

    expect(query).not.toHaveBeenCalled();
  });
});
