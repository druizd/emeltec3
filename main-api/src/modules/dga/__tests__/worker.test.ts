/**
 * Tests unitarios para worker.ts (fill DGA).
 *
 * Cubre el manejo de slots vacio sin dato (bug starvation 2026-07-10):
 *   - slot reciente sin dato → queda vacio (reintento normal)
 *   - slot más viejo que DGA_STALE_SLOT_HOURS sin dato → requires_review
 *     con fail_reason 'no_data_stale' (libera la ventana del fill)
 *   - pozo estancado (solo no_data atrasado) → logger.warn (falla visible)
 *   - slot con dato → pendiente (comportamiento existente intacto)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/heartbeat', () => ({
  beat: vi.fn(),
}));

vi.mock('../repo', () => ({
  findLastValidTotalizador: vi.fn(async () => null),
  findRecentDatoDgaReadings: vi.fn(async () => []),
  listPozosDgaActivos: vi.fn(async () => []),
  listVacioSlotsForSite: vi.fn(async () => []),
  markPozoDgaLastRun: vi.fn(async () => undefined),
  transitionSlotToPendiente: vi.fn(async () => true),
  transitionSlotToRequiresReview: vi.fn(async () => true),
}));

vi.mock('../validation', () => ({
  FROZEN_WINDOW_DEFAULT_N: 5,
  validateSlot: vi.fn(() => ({ ok: true, warnings: [] })),
}));

vi.mock('../../sites/repo', () => ({
  getDashboardBucketExact: vi.fn(async () => null),
  getMappingsBySiteId: vi.fn(async () => []),
  getPozoConfigBySiteId: vi.fn(async () => null),
  getSiteById: vi.fn(async () => ({ id: 'S999', id_serial: '151.0.0.1' })),
}));

vi.mock('../../sites/service', () => ({
  mapHistoricalDashboardRow: vi.fn(() => ({
    caudal: { valor: 12.5 },
    totalizador: { valor: 1000 },
    nivel_freatico: { valor: 8.2 },
  })),
}));

import { logger } from '../../../config/logger';
import {
  listVacioSlotsForSite,
  markPozoDgaLastRun,
  transitionSlotToPendiente,
  transitionSlotToRequiresReview,
} from '../repo';
import { getDashboardBucketExact } from '../../sites/repo';
import { processPozo, slotAgeHours } from '../worker';

const POZO = { sitio_id: 'S999' } as Parameters<typeof processPozo>[0];

function tsHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('slotAgeHours', () => {
  it('calcula edad en horas de un slot', () => {
    const now = Date.now();
    expect(slotAgeHours(new Date(now - 2 * 3_600_000).toISOString(), now)).toBeCloseTo(2, 3);
  });

  it('slot futuro da edad negativa', () => {
    const now = Date.now();
    expect(slotAgeHours(new Date(now + 3_600_000).toISOString(), now)).toBeLessThan(0);
  });
});

describe('processPozo — slots sin dato (no_data)', () => {
  it('slot reciente sin dato queda vacio para reintento (sin transición)', async () => {
    vi.mocked(listVacioSlotsForSite).mockResolvedValueOnce([
      { site_id: 'S999', ts: tsHoursAgo(1) },
    ]);
    vi.mocked(getDashboardBucketExact).mockResolvedValueOnce(null);

    await processPozo(POZO);

    expect(transitionSlotToPendiente).not.toHaveBeenCalled();
    expect(transitionSlotToRequiresReview).not.toHaveBeenCalled();
    expect(markPozoDgaLastRun).not.toHaveBeenCalled();
  });

  it('slot más viejo que el umbral stale pasa a requires_review con no_data_stale', async () => {
    // Default DGA_STALE_SLOT_HOURS = 48 → slot de 49h debe liberarse.
    const staleTs = tsHoursAgo(49);
    vi.mocked(listVacioSlotsForSite).mockResolvedValueOnce([{ site_id: 'S999', ts: staleTs }]);
    vi.mocked(getDashboardBucketExact).mockResolvedValueOnce(null);

    await processPozo(POZO);

    expect(transitionSlotToRequiresReview).toHaveBeenCalledTimes(1);
    expect(transitionSlotToRequiresReview).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: 'S999',
        ts: staleTs,
        caudal_instantaneo: null,
        flujo_acumulado: null,
        nivel_freatico: null,
        fail_reason: 'no_data_stale',
      }),
    );
    // Staling no es fill exitoso: no marca dga_last_run_at.
    expect(markPozoDgaLastRun).not.toHaveBeenCalled();
  });

  it('slot viejo sin dato no bloquea slot nuevo con dato en el mismo ciclo', async () => {
    const staleTs = tsHoursAgo(50);
    const freshTs = tsHoursAgo(1);
    vi.mocked(listVacioSlotsForSite).mockResolvedValueOnce([
      { site_id: 'S999', ts: staleTs },
      { site_id: 'S999', ts: freshTs },
    ]);
    vi.mocked(getDashboardBucketExact)
      .mockResolvedValueOnce(null) // stale → no_data
      .mockResolvedValueOnce({ bucket: freshTs, data: {} } as never); // fresh → dato

    await processPozo(POZO);

    expect(transitionSlotToRequiresReview).toHaveBeenCalledWith(
      expect.objectContaining({ ts: staleTs, fail_reason: 'no_data_stale' }),
    );
    expect(transitionSlotToPendiente).toHaveBeenCalledWith(
      expect.objectContaining({ ts: freshTs }),
    );
    expect(markPozoDgaLastRun).toHaveBeenCalledTimes(1);
  });

  it('pozo estancado (solo no_data atrasado, aún no stale) emite warn visible', async () => {
    // Default DGA_NO_DATA_WARN_HOURS = 3 → slot de 5h sin dato debe advertir.
    vi.mocked(listVacioSlotsForSite).mockResolvedValueOnce([
      { site_id: 'S999', ts: tsHoursAgo(5) },
    ]);
    vi.mocked(getDashboardBucketExact).mockResolvedValueOnce(null);

    await processPozo(POZO);

    expect(transitionSlotToRequiresReview).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: 'S999', no_data: 1 }),
      expect.stringContaining('estancado'),
    );
  });

  it('slot reciente sin dato (< umbral warn) no advierte — espera normal del cagg', async () => {
    vi.mocked(listVacioSlotsForSite).mockResolvedValueOnce([
      { site_id: 'S999', ts: tsHoursAgo(0.1) },
    ]);
    vi.mocked(getDashboardBucketExact).mockResolvedValueOnce(null);

    await processPozo(POZO);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('processPozo — slot con dato (regresión)', () => {
  it('slot con bucket exacto transiciona a pendiente y marca last_run', async () => {
    const ts = tsHoursAgo(1);
    vi.mocked(listVacioSlotsForSite).mockResolvedValueOnce([{ site_id: 'S999', ts }]);
    vi.mocked(getDashboardBucketExact).mockResolvedValueOnce({ bucket: ts, data: {} } as never);

    await processPozo(POZO);

    expect(transitionSlotToPendiente).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: 'S999', ts, caudal_instantaneo: 12.5 }),
    );
    expect(markPozoDgaLastRun).toHaveBeenCalledTimes(1);
    expect(transitionSlotToRequiresReview).not.toHaveBeenCalled();
  });
});
