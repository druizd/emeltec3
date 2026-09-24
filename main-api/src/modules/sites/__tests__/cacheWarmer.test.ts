/**
 * Incidente 24-09-2026: cacheWarmer usaba setInterval(50s) sin guardia de
 * reentrada. Con ~40 sitios x 2 límites, cada barrido tardaba 3-6 min, así
 * que se acumulaban varios barridos simultáneos peleando por el pool de
 * conexiones hasta tumbar /api/v2/companies/tree por statement timeout.
 * Estos tests fijan el contrato: guardia de reentrada, encadenado (no
 * reloj fijo), tolerancia a fallos por sitio y cadena viva ante errores.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../config/heartbeat', () => ({
  beat: vi.fn(),
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
}));

vi.mock('../repo', () => ({
  getDashboardHistory: vi.fn(),
  HISTORY_WINDOW_DAYS: 30,
}));

import { logger } from '../../../config/logger';
import { query } from '../../../config/dbHelpers';
import { getDashboardHistory } from '../repo';
import type { HistoryEquipoRow } from '../types';
import { warmAll, startCacheWarmerWorker, stopCacheWarmerWorker } from '../cacheWarmer';

const mockQuery = vi.mocked(query);
const mockGetDashboardHistory = vi.mocked(getDashboardHistory);
const mockLoggerWarn = vi.mocked(logger.warn);
const mockLoggerError = vi.mocked(logger.error);
const mockLoggerInfo = vi.mocked(logger.info);

function siteRows(...ids: string[]) {
  return { rows: ids.map((id_serial) => ({ id_serial })) };
}

/** Filas de `sitio` con el flag `has_recent_data` explícito (EXISTS acotado por HISTORY_WINDOW_DAYS). */
function activeSiteRows(...rows: Array<{ id_serial: string; has_recent_data: boolean }>) {
  return { rows };
}

/** Promesa controlable manualmente, para simular un getDashboardHistory que no termina. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('cacheWarmer — warmAll()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopCacheWarmerWorker();
  });

  afterEach(() => {
    stopCacheWarmerWorker();
    vi.useRealTimers();
  });

  it('un segundo barrido NO ejecuta consultas mientras el primero sigue en curso (bug real: con setInterval esto fallaba)', async () => {
    mockQuery.mockResolvedValue(siteRows('S1') as never);
    const gate = deferred<HistoryEquipoRow[]>();
    mockGetDashboardHistory.mockImplementation(async () => {
      await gate.promise;
      return [];
    });

    const first = warmAll();
    // Dejar que el primer barrido arranque y quede colgado en la primera llamada.
    await vi.waitFor(() => expect(mockGetDashboardHistory).toHaveBeenCalledTimes(1));

    const callsBeforeSecond = mockGetDashboardHistory.mock.calls.length;
    await warmAll(); // segundo barrido, el primero sigue en curso

    expect(mockGetDashboardHistory.mock.calls.length).toBe(callsBeforeSecond);
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('en curso'));

    gate.resolve([]);
    await first;
  });

  it('un sitio que falla no aborta el barrido: los siguientes se siguen calentando', async () => {
    mockQuery.mockResolvedValue(siteRows('S1', 'S2') as never);
    mockGetDashboardHistory.mockImplementation(async (serial: string) => {
      if (serial === 'S1') throw new Error('boom');
      return [];
    });

    await warmAll();

    // 2 sitios x 2 límites = 4 llamadas totales, pese a que S1 siempre falla.
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(4);
    expect(mockGetDashboardHistory).toHaveBeenCalledWith('S1', 500, { forceRefresh: true });
    expect(mockGetDashboardHistory).toHaveBeenCalledWith('S1', 2200, { forceRefresh: true });
    expect(mockGetDashboardHistory).toHaveBeenCalledWith('S2', 500, { forceRefresh: true });
    expect(mockGetDashboardHistory).toHaveBeenCalledWith('S2', 2200, { forceRefresh: true });
    // Las 2 fallas de S1 quedan registradas.
    const fallosLogueados = mockLoggerWarn.mock.calls.filter(
      (call) => call[1] === 'cache_warmer: error calentando sitio',
    );
    expect(fallosLogueados).toHaveLength(2);
  });

  it('si warmAll lanza (falla algo fuera del try/catch por sitio), el guardia igual se libera', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db caída'));
    mockQuery.mockResolvedValue(siteRows('S1') as never);
    mockGetDashboardHistory.mockResolvedValue([]);

    await expect(warmAll()).rejects.toThrow('db caída');

    // El guardia se liberó: un segundo warmAll() sí ejecuta consultas.
    await warmAll();
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(2);
  });

  it('un sitio activo SIN datos recientes no se calienta: no aparece en las llamadas a getDashboardHistory', async () => {
    mockQuery.mockResolvedValue(
      activeSiteRows(
        { id_serial: 'S1', has_recent_data: true },
        { id_serial: 'S2', has_recent_data: false },
      ) as never,
    );
    mockGetDashboardHistory.mockResolvedValue([]);

    await warmAll();

    // Solo S1 (con datos recientes) se calienta: 1 sitio x 2 límites.
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(2);
    expect(mockGetDashboardHistory).toHaveBeenCalledWith('S1', 500, { forceRefresh: true });
    expect(mockGetDashboardHistory).toHaveBeenCalledWith('S1', 2200, { forceRefresh: true });
    expect(mockGetDashboardHistory).not.toHaveBeenCalledWith('S2', 500, { forceRefresh: true });
    expect(mockGetDashboardHistory).not.toHaveBeenCalledWith('S2', 2200, { forceRefresh: true });
  });

  it('el resumen del barrido informa cuántos sitios activos se omitieron por no tener datos recientes', async () => {
    mockQuery.mockResolvedValue(
      activeSiteRows(
        { id_serial: 'S1', has_recent_data: true },
        { id_serial: 'S2', has_recent_data: false },
        { id_serial: 'S3', has_recent_data: false },
      ) as never,
    );
    mockGetDashboardHistory.mockResolvedValue([]);

    await warmAll();

    const summaryCall = mockLoggerInfo.mock.calls.find(
      (call) => call[1] === 'cache_warmer: ciclo completado',
    );
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.[0]).toEqual(expect.objectContaining({ count: 1, skipped: 2 }));
  });
});

describe('cacheWarmer — encadenado (startCacheWarmerWorker)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stopCacheWarmerWorker();
  });

  afterEach(() => {
    stopCacheWarmerWorker();
    vi.useRealTimers();
  });

  it('el siguiente barrido se programa recién cuando termina el anterior, no cada INTERVAL_MS fijo', async () => {
    mockQuery.mockResolvedValue(siteRows('S1') as never);
    const gate = deferred<HistoryEquipoRow[]>();
    mockGetDashboardHistory.mockImplementation(async () => gate.promise);

    startCacheWarmerWorker();
    // Deja correr las promesas pendientes (arranque de warmAll) sin avanzar el reloj.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(1);

    // El primer barrido sigue colgado. Aunque pase de sobra el INTERVAL_MS,
    // no debería dispararse un segundo barrido (eso es justamente el bug).
    await vi.advanceTimersByTimeAsync(200_000);
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(1);

    // Se libera el primer barrido: termina sus 2 llamadas pendientes (limit
    // 500 y 2200, mismo sitio) y recién ahí queda libre para encadenar.
    gate.resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(2);

    // Antes de que pase INTERVAL_MS desde que terminó, no debe haber un segundo barrido.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(4);
  });

  it('si el barrido lanza, el guardia se libera y la cadena sigue viva', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db caída'));
    mockQuery.mockResolvedValue(siteRows('S1') as never);
    mockGetDashboardHistory.mockResolvedValue([]);

    startCacheWarmerWorker();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('fallo no controlado'),
    );

    // La cadena sigue viva: el siguiente barrido dispara tras INTERVAL_MS
    // (2 llamadas: 1 sitio x 2 límites).
    await vi.advanceTimersByTimeAsync(50_000);
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(2);
  });

  it('stopCacheWarmerWorker() cancela el barrido encadenado pendiente', async () => {
    mockQuery.mockResolvedValue(siteRows('S1') as never);
    mockGetDashboardHistory.mockResolvedValue([]);

    startCacheWarmerWorker();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(2);

    stopCacheWarmerWorker();
    await vi.advanceTimersByTimeAsync(200_000);

    // Sin el timer pendiente, no debería haber una segunda pasada.
    expect(mockGetDashboardHistory).toHaveBeenCalledTimes(2);
  });
});
