/**
 * Tests unitarios para evaluarAlertaReviewQueue.
 *
 * Spec: §"review_queue_acumulacion" — todos los escenarios.
 * ADR-5: umbral N leído de alerta.umbral_bajo.
 * ADR-6: el veredicto pasa por `debeNotificar`, que es quien aplica el cooldown,
 * agrupa las repeticiones de un evento reconocido y rearma cuando la cola baja
 * del umbral. Un backlog no se vacía solo, así que sin esa agrupación la
 * condición avisaba una vez por cooldown de forma indefinida.
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

/**
 * Cliente de base falso que responde según el SQL recibido, no por posición.
 * El orden de las consultas depende del estado del evento abierto (reconocido o
 * no), así que un arreglo posicional se rompe en cuanto el evaluador deja de
 * empezar siempre por el cooldown.
 */
function makeClient(opts: {
  eventoAbierto?: { id: string; reconocida_at: string | null } | null;
  dentroDeCooldown?: boolean;
  enRevision?: number;
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    _calls: calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM alertas_eventos') && sql.includes('resuelta = FALSE')) {
        return { rows: opts.eventoAbierto ? [opts.eventoAbierto] : [] };
      }
      if (sql.includes('SELECT 1 FROM alertas_eventos')) {
        return { rows: opts.dentroDeCooldown ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('COUNT(*)') && sql.includes('dato_dga')) {
        return { rows: [{ n: opts.enRevision ?? 0 }] };
      }
      if (sql.startsWith('INSERT INTO alertas_eventos')) {
        return { rows: [{ id: 'evento-rq-nuevo' }] };
      }
      return { rows: [] };
    }),
  };
  return client;
}

const hizoCount = (c: ReturnType<typeof makeClient>) =>
  c._calls.some((x) => x.sql.toUpperCase().includes('COUNT'));
const hizoInsert = (c: ReturnType<typeof makeClient>) =>
  c._calls.some((x) => x.sql.toUpperCase().includes('INSERT'));
const hizoUpdate = (c: ReturnType<typeof makeClient>, frag: string) =>
  c._calls.some((x) => x.sql.includes('UPDATE alertas_eventos') && x.sql.includes(frag));
const insertDe = (c: ReturnType<typeof makeClient>) =>
  c._calls.find((x) => x.sql.toUpperCase().includes('INSERT'));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('evaluarAlertaReviewQueue — umbral_bajo inválido (misconfig guard)', () => {
  it('umbral_bajo = null → no emite ninguna query, no inserta, no lanza error', async () => {
    const client = makeClient({});
    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: null as unknown as number }));

    expect(client._calls).toHaveLength(0);
  });

  it('umbral_bajo = 0 → no emite ninguna query, no inserta', async () => {
    const client = makeClient({});
    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 0 }));

    expect(client._calls).toHaveLength(0);
  });

  it('umbral_bajo negativo → también se trata como misconfig', async () => {
    const client = makeClient({});
    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: -1 }));

    expect(client._calls).toHaveLength(0);
  });
});

describe('evaluarAlertaReviewQueue — cooldown activo', () => {
  it('cooldown activo → NO emite COUNT query, NO inserta', async () => {
    const client = makeClient({ dentroDeCooldown: true, enRevision: 40 });

    await evaluarAlertaReviewQueue(client, makeAlerta());

    // El COUNT sobre dato_dga se evalúa de forma diferida: si el cooldown ya
    // corta el ciclo, no se paga (ADR-6a).
    expect(hizoCount(client)).toBe(false);
    expect(hizoInsert(client)).toBe(false);
  });
});

describe('evaluarAlertaReviewQueue — umbral estrictamente mayor que N', () => {
  it('COUNT = 5, N = 5 → NO inserta (5 no es estrictamente mayor que 5)', async () => {
    const client = makeClient({ enRevision: 5 });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    expect(hizoInsert(client)).toBe(false);
  });

  it('COUNT = 2, N = 5 → NO inserta (count debajo del umbral)', async () => {
    const client = makeClient({ enRevision: 2 });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    expect(hizoInsert(client)).toBe(false);
  });

  it('COUNT = 6, N = 5 → INSERTA con valor_texto="6", valor_detectado=NULL, severidad=alerta.severidad', async () => {
    const client = makeClient({ enRevision: 6 });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    const insertCall = insertDe(client);
    expect(insertCall).toBeDefined();

    const params = insertCall!.params;
    expect(params).toContain('6'); // valor_texto
    expect(params).toContain(null); // valor_detectado
    expect(params).toContain('media'); // severidad del alerta fixture
  });

  it('cooldown activo con COUNT > N → NO inserta (cooldown tiene prioridad)', async () => {
    const client = makeClient({ dentroDeCooldown: true, enRevision: 40 });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    expect(hizoInsert(client)).toBe(false);
  });
});

describe('evaluarAlertaReviewQueue — mensaje en español', () => {
  it('mensaje contiene referencia a requires_review o cola de revisión', async () => {
    const client = makeClient({ enRevision: 8 });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    const mensaje = insertDe(client)!.params.find(
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

describe('evaluarAlertaReviewQueue — evento reconocido', () => {
  it('reconocido y la cola sigue sobre el umbral → agrupa la repetición, no crea evento', async () => {
    const client = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-18T10:00:00Z' },
      enRevision: 40,
    });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    expect(hizoInsert(client)).toBe(false);
    expect(hizoUpdate(client, 'repeticiones')).toBe(true);
  });

  it('reconocido y la cola bajó del umbral → resuelve el evento para volver a avisar', async () => {
    const client = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-18T10:00:00Z' },
      enRevision: 2,
    });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    expect(hizoUpdate(client, 'resuelta = TRUE')).toBe(true);
    expect(hizoInsert(client)).toBe(false);
  });

  it('abierto SIN reconocer y sobre el umbral → sigue rigiendo el cooldown', async () => {
    const client = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: null },
      dentroDeCooldown: true,
      enRevision: 40,
    });

    await evaluarAlertaReviewQueue(client, makeAlerta({ umbral_bajo: 5 }));

    expect(hizoInsert(client)).toBe(false);
    expect(hizoUpdate(client, 'repeticiones')).toBe(false);
    expect(hizoUpdate(client, 'resuelta = TRUE')).toBe(false);
  });
});
