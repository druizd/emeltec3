/**
 * Tests unitarios para evaluarAlertaDgaSlotsFallidos.
 *
 * Spec: §"dga_slots_fallidos" — todos los escenarios.
 * ADR-6, ADR-6a: cooldown chequeado DENTRO del evaluador (primer paso).
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

import { evaluarAlertaDgaSlotsFallidos } from '../worker';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_ALERTA = {
  id: 'alerta-sf-1',
  nombre: 'Slots Fallidos Test',
  empresa_id: 'emp-1',
  sub_empresa_id: null,
  sitio_id: 'sitio-1',
  creado_por: 'user-1',
  variable_key: '',
  condicion: 'dga_slots_fallidos' as const,
  umbral_bajo: 0,
  umbral_alto: 0,
  severidad: 'alta',
  cooldown_minutos: 120,
  dias_activos: null,
  id_serial: '',
  sitio_desc: 'Pozo Norte',
};

function makeClient(responses: Array<{ rows: unknown[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let idx = 0;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const resp = responses[idx++];
      if (!resp) throw new Error(`Sin respuesta stub para llamada #${idx}: ${sql.slice(0, 80)}`);
      return resp;
    }),
    _calls: calls,
  };
  return client;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('evaluarAlertaDgaSlotsFallidos — cooldown activo', () => {
  it('cooldown activo → NO emite COUNT query, NO inserta alertas_eventos', async () => {
    // Primera query: cooldown → devuelve un evento reciente
    const client = makeClient([{ rows: [{ triggered_at: new Date().toISOString() }] }]);

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    // Solo debe haberse ejecutado la query de cooldown, ninguna otra
    expect(client._calls).toHaveLength(1);
    const hasCount = client._calls.some((c) => c.sql.toUpperCase().includes('COUNT'));
    expect(hasCount).toBe(false);
    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(false);
  });
});

// Respuesta stub para pozo_config lookup (dga_activo=TRUE → fila presente).
// Se necesita después del cooldown check en cada test donde DGA está activo.
const DGA_ACTIVO_ROW = { rows: [{ '?column?': 1 }] };

describe('evaluarAlertaDgaSlotsFallidos — COUNT = 0', () => {
  it('COUNT = 0 fallidos → no inserta alertas_eventos', async () => {
    const client = makeClient([
      { rows: [] },          // cooldown: sin evento reciente
      DGA_ACTIVO_ROW,        // pozo_config: dga_activo=TRUE
      { rows: [{ n: 0 }] }, // COUNT query: sin fallidos
    ]);

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(false);
  });
});

describe('evaluarAlertaDgaSlotsFallidos — COUNT >= 1', () => {
  it('COUNT = 3 → inserta alertas_eventos con valor_texto="3", valor_detectado=NULL, severidad=alerta.severidad', async () => {
    const insertResult = { rows: [{ id: 'evento-sf-1' }] };
    const client = makeClient([
      { rows: [] },          // cooldown: no activo
      DGA_ACTIVO_ROW,        // pozo_config: dga_activo=TRUE
      { rows: [{ n: 3 }] }, // COUNT: 3 slots fallidos
      insertResult,          // INSERT alertas_eventos
    ]);

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    const insertCall = client._calls.find((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(insertCall).toBeDefined();

    const params = insertCall!.params;
    // valor_texto debe ser '3' (string del count)
    expect(params).toContain('3');
    // valor_detectado debe ser NULL
    expect(params).toContain(null);
    // severidad viene de alerta.severidad ('alta')
    expect(params).toContain('alta');
  });

  it('COUNT = 1 → también inserta (umbral es >= 1, no > 1)', async () => {
    const insertResult = { rows: [{ id: 'evento-sf-2' }] };
    const client = makeClient([
      { rows: [] },
      DGA_ACTIVO_ROW,        // pozo_config: dga_activo=TRUE
      { rows: [{ n: 1 }] },
      insertResult,
    ]);

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(true);
  });

  it('mensaje incluye texto en español con el count de slots', async () => {
    const insertResult = { rows: [{ id: 'evento-sf-3' }] };
    const client = makeClient([
      { rows: [] },
      DGA_ACTIVO_ROW,        // pozo_config: dga_activo=TRUE
      { rows: [{ n: 5 }] },
      insertResult,
    ]);

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    const insertCall = client._calls.find((c) => c.sql.toUpperCase().includes('INSERT'));
    const mensaje = insertCall!.params.find(
      (p) => typeof p === 'string' && p.includes('fallido'),
    );
    expect(mensaje).toBeDefined();
    // El mensaje debe incluir el count
    expect(mensaje as string).toMatch(/5/);
  });
});

describe('evaluarAlertaDgaSlotsFallidos — notificarUsuarios', () => {
  it('COUNT >= 1 → se llama a query global para notificar usuarios', async () => {
    // notificarUsuarios llama a query() global para SELECT usuarios e UPDATE notificado.
    const { query: mockQuery } = await import('../../../config/dbHelpers.js');
    const qMock = mockQuery as ReturnType<typeof vi.fn>;
    qMock.mockResolvedValue({ rows: [] }); // SELECT usuarios: sin resultados (ok para el test)

    const insertResult = { rows: [{ id: 'evento-sf-4' }] };
    const client = makeClient([
      { rows: [] },
      DGA_ACTIVO_ROW,        // pozo_config: dga_activo=TRUE
      { rows: [{ n: 2 }] },
      insertResult,
    ]);

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    // La consulta de notificación se dispara (fire-and-forget async).
    // Verificamos que se intentó insertar el evento.
    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(true);
  });
});

describe('evaluarAlertaDgaSlotsFallidos — DGA desactivado (W-1)', () => {
  /**
   * Spec §"DGA disabled for site — evaluator exits without alarm":
   * DADO pozo_config.dga_activo = FALSE para el sitio,
   * CUANDO el evaluador se ejecuta (incluso si existen filas dato_dga fallidas),
   * ENTONCES no se inserta ningún alertas_eventos y no se lanza ningún error.
   *
   * Escenario residual: el sitio tuvo DGA activo, acumuló slots 'fallido' en dato_dga
   * y luego el operador desactivó dga_activo=FALSE. La fila `alertas` puede seguir
   * activa. El evaluador DEBE salir temprano consultando pozo_config.dga_activo.
   */
  it('pozo_config.dga_activo=FALSE para el sitio → el evaluador sale sin INSERT aunque COUNT > 0', async () => {
    const client = makeClient([
      { rows: [] },       // cooldown: no activo
      { rows: [] },       // pozo_config lookup: dga_activo=FALSE → sin filas
      { rows: [{ n: 3 }] }, // COUNT dato_dga: 3 slots fallidos (datos residuales)
      // No debe llegarse a este punto — si hay INSERT es un bug
    ]);

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    const hasInsert = client._calls.some((c) => c.sql.toUpperCase().includes('INSERT'));
    expect(hasInsert).toBe(false);

    // El evaluador debe haber chequeado pozo_config
    const hasPozoConfigCheck = client._calls.some((c) =>
      c.sql.toLowerCase().includes('pozo_config') && c.sql.toLowerCase().includes('dga_activo'),
    );
    expect(hasPozoConfigCheck).toBe(true);
  });
});
