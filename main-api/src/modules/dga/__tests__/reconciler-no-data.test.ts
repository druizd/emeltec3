/**
 * Tests de los checks G y H del reconciler (slots 'no_data_stale').
 *
 * Contexto: el fill libera a requires_review los slots vacíos que pasan
 * DGA_STALE_SLOT_HOURS sin bucket, y ahí quedaban muertos — el fill solo
 * recorre 'vacio', así que un dato que llegaba después no rellenaba nada, y la
 * cola solo crecía manteniendo a los sitios sobre el umbral de
 * review_queue_acumulacion.
 *
 *   G — bucket disponible → vuelve a 'vacio' para que el fill lo recompute.
 *   H — sigue sin bucket tras N días → baja documentada, sale de la cola.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/heartbeat', () => ({ beat: vi.fn() }));

vi.mock('../notifier', () => ({
  renderAdminShell: vi.fn(() => '<html></html>'),
  sendDgaAdminAlert: vi.fn(async () => undefined),
}));

vi.mock('../repo', () => ({
  countDoubleSubmission: vi.fn(async () => 0),
  findExistingSuccessfulAudit: vi.fn(async () => null),
  listDoubleSubmission: vi.fn(async () => []),
  listDriftAuditEnviadoVsEstado: vi.fn(async () => []),
  listEnviadoSinAudit: vi.fn(async () => []),
  listNoDataStaleConDatoTardio: vi.fn(async () => []),
  listNoDataStaleVencidos: vi.fn(async () => []),
  listSitiosDesconectados: vi.fn(async () => []),
  listStuckEnviando: vi.fn(async () => []),
  listVacioSlotsStale: vi.fn(async () => []),
  markSlotEnviadoSinReenvio: vi.fn(async () => true),
  markSlotNoDataDefinitivo: vi.fn(async () => true),
  markSlotOkSinComprobante: vi.fn(async () => true),
  reconcileMarkEnviado: vi.fn(async () => true),
  resetSlotAVacio: vi.fn(async () => true),
  unlockStuckEnviando: vi.fn(async () => true),
}));

import { logger } from '../../../config/logger';
import {
  listNoDataStaleConDatoTardio,
  listNoDataStaleVencidos,
  markSlotNoDataDefinitivo,
  resetSlotAVacio,
} from '../repo';
import { runReconcilerCycle } from '../reconciler';

const tardio = (site_id: string, ts: string, dias: number) => ({ site_id, ts, dias });

/** El ciclo traga excepciones: sin este guard un mock faltante pasa como éxito. */
function expectCicloSano(): void {
  const fallo = vi
    .mocked(logger.error)
    .mock.calls.some((c) => String(c[1] ?? '').includes('ciclo falló'));
  expect(fallo).toBe(false);
}

describe('reconciler check G — rescate de dato tardío', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve a vacio los slots cuyo bucket ya llegó', async () => {
    vi.mocked(listNoDataStaleConDatoTardio).mockResolvedValueOnce([
      tardio('S126', '2026-08-12T14:00:00Z', 6),
      tardio('S127', '2026-08-13T09:00:00Z', 5),
    ]);

    await runReconcilerCycle();

    expectCicloSano();
    expect(resetSlotAVacio).toHaveBeenCalledTimes(2);
    expect(resetSlotAVacio).toHaveBeenCalledWith({
      site_id: 'S126',
      ts: '2026-08-12T14:00:00Z',
    });
  });

  it('no rescata nada cuando ningún slot tiene bucket', async () => {
    await runReconcilerCycle();

    expectCicloSano();
    expect(resetSlotAVacio).not.toHaveBeenCalled();
  });

  it('sigue con el resto de los slots si uno falla', async () => {
    vi.mocked(listNoDataStaleConDatoTardio).mockResolvedValueOnce([
      tardio('S126', '2026-08-12T14:00:00Z', 6),
      tardio('S127', '2026-08-13T09:00:00Z', 5),
    ]);
    vi.mocked(resetSlotAVacio).mockRejectedValueOnce(new Error('deadlock'));

    await runReconcilerCycle();

    expectCicloSano();
    expect(resetSlotAVacio).toHaveBeenCalledTimes(2);
  });

  it('no cuenta como rescate el slot que otro ciclo ya movió', async () => {
    vi.mocked(listNoDataStaleConDatoTardio).mockResolvedValueOnce([
      tardio('S126', '2026-08-12T14:00:00Z', 6),
    ]);
    vi.mocked(resetSlotAVacio).mockResolvedValueOnce(false);

    await runReconcilerCycle();

    expectCicloSano();
    const conHallazgos = vi
      .mocked(logger.info)
      .mock.calls.some((c) => String(c[1] ?? '').includes('ciclo con hallazgos'));
    expect(conHallazgos).toBe(false);
  });
});

describe('reconciler check H — baja definitiva sin dato', () => {
  beforeEach(() => vi.clearAllMocks());

  it('da de baja los vencidos pasando el umbral aplicado', async () => {
    vi.mocked(listNoDataStaleVencidos).mockResolvedValueOnce([
      tardio('S105', '2026-05-23T12:00:00Z', 87),
    ]);

    await runReconcilerCycle();

    expectCicloSano();
    expect(markSlotNoDataDefinitivo).toHaveBeenCalledWith({
      site_id: 'S105',
      ts: '2026-05-23T12:00:00Z',
      dias_umbral: 30,
    });
  });

  it('reporta la baja en el log del ciclo', async () => {
    vi.mocked(listNoDataStaleVencidos).mockResolvedValueOnce([
      tardio('S105', '2026-05-23T12:00:00Z', 87),
      tardio('S106', '2026-05-24T12:00:00Z', 86),
    ]);

    await runReconcilerCycle();

    expectCicloSano();
    const call = vi
      .mocked(logger.info)
      .mock.calls.find((c) => String(c[1] ?? '').includes('ciclo con hallazgos'));
    expect(call?.[0]).toMatchObject({ no_data_baja_definitiva: 2 });
  });

  it('no reporta baja si el UPDATE no tocó ninguna fila', async () => {
    vi.mocked(listNoDataStaleVencidos).mockResolvedValueOnce([
      tardio('S105', '2026-05-23T12:00:00Z', 87),
    ]);
    vi.mocked(markSlotNoDataDefinitivo).mockResolvedValueOnce(false);

    await runReconcilerCycle();

    expectCicloSano();
    const conHallazgos = vi
      .mocked(logger.info)
      .mock.calls.some((c) => String(c[1] ?? '').includes('ciclo con hallazgos'));
    expect(conHallazgos).toBe(false);
  });
});

describe('reconciler check H — desactivado con DGA_NO_DATA_GIVEUP_DAYS=0', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('no consulta ni da de baja nada', async () => {
    vi.stubEnv('DGA_NO_DATA_GIVEUP_DAYS', '0');
    vi.resetModules();
    const { runReconcilerCycle: cycle } = await import('../reconciler.js');
    const repo = await import('../repo.js');
    vi.clearAllMocks();

    await cycle();

    expect(repo.listNoDataStaleVencidos).not.toHaveBeenCalled();
    expect(repo.markSlotNoDataDefinitivo).not.toHaveBeenCalled();
  });
});
