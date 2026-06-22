/**
 * Tests unitarios para evaluarAlertaReviewQueue.
 *
 * Spec: §"review_queue_acumulacion" — todos los escenarios.
 * ADR-5: umbral N leído de alerta.umbral_bajo.
 * ADR-6a: cooldown chequeado DENTRO del evaluador.
 * Resultado: valor_texto=String(n), valor_detectado=NULL, severidad=alerta.severidad.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    workers: { alerts: false },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { evaluarAlertaReviewQueue } from '../worker';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAlerta(overrides: { umbral_bajo?: number | null } = {}) {
  return {
    id: 'alerta-rq-1',
    nombre: 'Review Queue Test',
    empresa_id: 'emp-1',
    sub_empresa_id: null,
    sitio_id: 'sitio-1',
    creado_por: 'user-1',
    variable_key: '',
    condicion: 'review_queue_acumulacion' as const,
    umbral_bajo: 5,
    umbral_alto: 0,
    severidad: 'media',
    cooldown_minutos: 180,
    dias_activos: null,
    id_serial: '',
    sitio_desc: 'Pozo Sur',
    ...overrides,
  };
}

function makeClient(responses: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let idx = 0;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const resp = responses[idx++];
      if (!resp) throw new Error(`Sin respuesta stub #${idx}: ${sql.slice(0, 80)}`);
      return resp;
    }),
    _calls: calls,
  };
  return client;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('evaluarAlertaReviewQueue — umbral_bajo inválido (misconfig guard)', () => {
  it('umbral_bajo = null → no emite COUNT query, no inserta, no lanza error', async () => {
    const client = makeClient([]); // ninguna respuesta esperada
    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: null as unknown as number }));

    expect(client._calls).toHaveLength(0);
  });

  it('umbral_bajo = 0 → no emite COUNT query, no inserta', async () => {
    const client = makeClient([]);
    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 0 }));

    expect(client._calls).toHaveLength(0);
  });

  it('umbral_bajo negativo → también se trata como misconfig', async () => {
    const client = makeClient([]);
    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: -1 }));

    expect(client._calls).toHaveLength(0);
  });
});

describe('evaluarAlertaReviewQueue — cooldown activo', () => {
  it('cooldown activo → NO emite COUNT query, NO inserta', async () => {
    // Primera query es cooldown → devuelve un evento reciente
    const client = makeClient([{ rows: [{ triggered_at: new Date().toISOString() }] }]);

    await evaluarAlertaReviewQueue(client, makeAlerta());

    expect(client._calls).toHaveLength(1);
    const hasCount = client._calls.some((c) => c.sql.toUpperCase().includes('COUNT'));
    expect(hasCount).toBe(false);
  });
});

describe('evaluarAlertaReviewQueue — umbral estrictamente mayor que N', () => {
  it('COUNT = 5, N = 5 → NO inserta (5 no es estrictamente mayor que 5)', async () => {
    const client = makeClient([
      { rows: [] },          // cooldown: no activo
      { rows: [{ n: 5 }] }, // COUNT: 5 — igual al umbral, NO dispara
    ]);

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(false);
  });

  it('COUNT = 2, N = 5 → NO inserta (count debajo del umbral)', async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [{ n: 2 }] },
    ]);

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(false);
  });

  it('COUNT = 6, N = 5 → INSERTA con valor_texto="6", valor_detectado=NULL, severidad=alerta.severidad', async () => {
    const insertResult = { rows: [{ id: 'evento-rq-1' }] };
    const client = makeClient([
      { rows: [] },          // cooldown: no activo
      { rows: [{ n: 6 }] }, // COUNT: 6 > umbral 5
      insertResult,          // INSERT alertas_eventos
    ]);

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    const insertCall = client._calls.find((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(insertCall).toBeDefined();

    const params = insertCall!.params;
    expect(params).toContain('6');      // valor_texto
    expect(params).toContain(null);     // valor_detectado
    expect(params).toContain('media');  // severidad del alerta fixture
  });

  it('cooldown activo con COUNT > N → NO inserta (cooldown tiene prioridad)', async () => {
    const client = makeClient([
      { rows: [{ triggered_at: new Date().toISOString() }] }, // cooldown activo
    ]);

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(false);
  });
});

describe('evaluarAlertaReviewQueue — mensaje en español', () => {
  it('mensaje contiene referencia a requires_review o cola de revisión', async () => {
    const insertResult = { rows: [{ id: 'evento-rq-2' }] };
    const client = makeClient([
      { rows: [] },
      { rows: [{ n: 8 }] },
      insertResult,
    ]);

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    const insertCall = client._calls.find((c) => c.sql.toUpperCase().includes('INSERT'));
    const mensaje = insertCall!.params.find(
      (p) =>
        typeof p === 'string' &&
        (p.toLowerCase().includes('revisi') || p.toLowerCase().includes('review')),
    );
    expect(mensaje).toBeDefined();
    // El mensaje debe incluir el count y el umbral
    expect(mensaje as string).toMatch(/8/);
    expect(mensaje as string).toMatch(/5/);
  });
});
