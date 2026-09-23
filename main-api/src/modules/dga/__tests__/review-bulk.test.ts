/**
 * Acción en bloque sobre slots sueltos de la cola de revisión.
 *
 * Por qué existe este endpoint: el código 2FA es de un solo uso
 * (`shared/email-otp` hace `pending.delete` al validarlo), y el frontend
 * mandaba una petición por slot. Aceptar los 128 slots de S105 pedía 128
 * códigos y mandaba 128 correos, así que la cola no se vaciaba nunca.
 *
 * Lo que se protege acá es el comportamiento del lote, que es lo que hace la
 * diferencia entre una herramienta usable y una que hay que babysittear:
 *
 *   1. Un ítem que falla NO aborta el resto.
 *   2. El resultado dice exactamente cuáles no entraron y por qué.
 *   3. Cada ítem lleva sus propios valores (el operador pudo editar una fila).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as DgaRepo from '../repo';

// appConfig valida el entorno al cargarse y hace process.exit(1) si falta algo;
// el árbol de `../repo` lo arrastra vía config/redis.
vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    redis: { url: '', enabled: false },
    dga: { encryptionKey: 'x'.repeat(32) },
    monitor: { primaryEmail: 'monitoreo@emeltec.cl' },
  },
}));

vi.mock('../../../config/redis', () => ({
  getRedis: vi.fn(() => null),
  redisEnabled: false,
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  transaction: vi.fn(),
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const repoMock = vi.hoisted(() => ({
  acceptReviewSlotWithValues: vi.fn(async (_input: Record<string, unknown>) => true),
  markReviewSlotFailedManual: vi.fn(async (_input: Record<string, unknown>) => true),
}));

vi.mock('../repo', async (importOriginal) => {
  const real = await importOriginal<typeof DgaRepo>();
  return { ...real, ...repoMock };
});

import { applyReviewDecisionBulk } from '../service';

const ITEMS = [
  { site_id: 'S105', ts: '2026-09-18T12:00:00.000Z' },
  { site_id: 'S105', ts: '2026-09-18T13:00:00.000Z' },
  { site_id: 'S119', ts: '2026-09-18T14:00:00.000Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  repoMock.acceptReviewSlotWithValues.mockResolvedValue(true);
  repoMock.markReviewSlotFailedManual.mockResolvedValue(true);
});

describe('applyReviewDecisionBulk — descarte', () => {
  it('aplica todos y no reporta fallidos', async () => {
    const res = await applyReviewDecisionBulk({
      action: 'discard',
      admin_note: 'Sin dato crudo declarable',
      admin_email: 'druiz@emeltec.cl',
      items: ITEMS,
    });

    expect(res.aplicados).toBe(3);
    expect(res.fallidos).toEqual([]);
    expect(repoMock.markReviewSlotFailedManual).toHaveBeenCalledTimes(3);
  });

  it('propaga la nota y el autor a cada slot: el rastro no se pierde por ser lote', async () => {
    await applyReviewDecisionBulk({
      action: 'discard',
      admin_note: 'Recambio de caudalímetro 18-09',
      admin_email: 'druiz@emeltec.cl',
      items: [ITEMS[0]!],
    });

    expect(repoMock.markReviewSlotFailedManual).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: 'S105',
        admin_note: 'Recambio de caudalímetro 18-09',
        admin_email: 'druiz@emeltec.cl',
      }),
    );
  });
});

describe('applyReviewDecisionBulk — aceptación', () => {
  it('manda los valores de CADA ítem, no los del primero', async () => {
    await applyReviewDecisionBulk({
      action: 'accept',
      admin_note: 'Verificado contra el totalizador',
      admin_email: 'druiz@emeltec.cl',
      items: [
        { ...ITEMS[0]!, values: { caudal_instantaneo: 12.5, flujo_acumulado: 100 } },
        { ...ITEMS[1]!, values: { caudal_instantaneo: 18.4, flujo_acumulado: 200 } },
      ],
    });

    const llamadas = repoMock.acceptReviewSlotWithValues.mock.calls;
    expect(llamadas[0]![0]).toMatchObject({ caudal_instantaneo: 12.5, flujo_acumulado: 100 });
    expect(llamadas[1]![0]).toMatchObject({ caudal_instantaneo: 18.4, flujo_acumulado: 200 });
  });

  it('un ítem sin values falla solo él: aceptar exige valores', async () => {
    const res = await applyReviewDecisionBulk({
      action: 'accept',
      admin_note: 'Verificado contra el totalizador',
      admin_email: 'druiz@emeltec.cl',
      items: [{ ...ITEMS[0]!, values: { caudal_instantaneo: 1 } }, ITEMS[1]!],
    });

    expect(res.aplicados).toBe(1);
    expect(res.fallidos).toHaveLength(1);
    expect(res.fallidos[0]!.ts).toBe(ITEMS[1]!.ts);
  });
});

describe('applyReviewDecisionBulk — resiliencia del lote', () => {
  it('un slot que ya no está en requires_review no se lleva a los demás', async () => {
    // El repo devuelve false cuando el slot cambió de estado entremedio;
    // `applyReviewDecision` lo convierte en NotFoundError.
    repoMock.markReviewSlotFailedManual
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const res = await applyReviewDecisionBulk({
      action: 'discard',
      admin_note: 'Cierre del backlog de julio',
      admin_email: 'druiz@emeltec.cl',
      items: ITEMS,
    });

    expect(res.aplicados).toBe(2);
    expect(res.fallidos).toHaveLength(1);
    expect(res.fallidos[0]).toMatchObject({ site_id: 'S105', ts: ITEMS[1]!.ts });
    expect(res.fallidos[0]!.error).toMatch(/requires_review|pendiente/);
    // Y lo importante: el tercero igual se intentó.
    expect(repoMock.markReviewSlotFailedManual).toHaveBeenCalledTimes(3);
  });

  it('una excepción del repo tampoco corta el lote', async () => {
    repoMock.markReviewSlotFailedManual
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValue(true);

    const res = await applyReviewDecisionBulk({
      action: 'discard',
      admin_note: 'Cierre del backlog de julio',
      admin_email: 'druiz@emeltec.cl',
      items: ITEMS,
    });

    expect(res.aplicados).toBe(2);
    expect(res.fallidos[0]!.error).toBe('deadlock detected');
  });

  it('mantiene el orden de los ítems recibidos', async () => {
    await applyReviewDecisionBulk({
      action: 'discard',
      admin_note: 'Cierre del backlog de julio',
      admin_email: 'druiz@emeltec.cl',
      items: ITEMS,
    });

    const tss = repoMock.markReviewSlotFailedManual.mock.calls.map(
      (c) => (c[0] as { ts: string }).ts,
    );
    expect(tss).toEqual(ITEMS.map((i) => i.ts));
  });
});
