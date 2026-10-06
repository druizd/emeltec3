/**
 * Un ciclo del worker de alertas nunca corre en paralelo con otro: si la base
 * va lenta, un ciclo largo no puede apilar ciclos nuevos (cada uno retiene una
 * conexión del pool y empeora la lentitud).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    workers: { alerts: true },
  },
}));

const warnMock = vi.fn();
vi.mock('../../../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...a: unknown[]) => warnMock(...a),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const getClientMock = vi.fn();
vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  getClient: (...a: unknown[]) => getClientMock(...a),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { runCycle, startAlertsWorker, stopAlertsWorker } from '../worker';

/** Cliente cuya consulta de alertas queda colgada hasta llamar a `liberar`. */
function makeClientLento() {
  let liberar: () => void = () => {};
  const bloqueo = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  const client = {
    query: vi.fn(async () => {
      await bloqueo;
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { client, liberar: () => liberar() };
}

function makeClientRapido() {
  return { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
}

beforeEach(() => {
  getClientMock.mockReset();
  warnMock.mockReset();
});

afterEach(() => {
  stopAlertsWorker();
  vi.useRealTimers();
});

describe('alertas — guarda de solapamiento', () => {
  it('un segundo ciclo lanzado con el primero en curso no corre y avisa', async () => {
    const { client, liberar } = makeClientLento();
    getClientMock.mockResolvedValue(client);

    const primero = runCycle();
    await vi.waitFor(() => expect(client.query).toHaveBeenCalledTimes(1));

    await runCycle();
    expect(getClientMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('se omite el ciclo'));

    liberar();
    await primero;
    expect(client.release).toHaveBeenCalledTimes(1);

    // Terminado el primero, un ciclo nuevo vuelve a poder correr.
    getClientMock.mockResolvedValue(makeClientRapido());
    await runCycle();
    expect(getClientMock).toHaveBeenCalledTimes(2);
  });

  it('el guardia se libera aunque el ciclo falle', async () => {
    getClientMock.mockRejectedValueOnce(new Error('pool agotado'));
    await runCycle();

    getClientMock.mockResolvedValue(makeClientRapido());
    await runCycle();
    expect(getClientMock).toHaveBeenCalledTimes(2);
  });

  it('encadena el siguiente ciclo solo cuando el anterior termina', async () => {
    vi.useFakeTimers();
    const { client, liberar } = makeClientLento();
    getClientMock.mockResolvedValue(client);

    startAlertsWorker();
    await vi.waitFor(() => expect(client.query).toHaveBeenCalledTimes(1));

    // Pasan varios intervalos con el ciclo colgado: no se lanza otro.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(getClientMock).toHaveBeenCalledTimes(1);

    getClientMock.mockResolvedValue(makeClientRapido());
    liberar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getClientMock).toHaveBeenCalledTimes(2);
  });
});
