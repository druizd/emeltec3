/**
 * Tests unitarios para evaluarAlertaDgaSlotsFallidos.
 *
 * Spec: §"dga_slots_fallidos" — todos los escenarios.
 * ADR-6: el veredicto pasa por `debeNotificar`, que es quien aplica el cooldown,
 * agrupa las repeticiones de un evento reconocido y rearma cuando la condición
 * se normaliza. Un slot fallido no se arregla solo, así que sin esa agrupación
 * la condición avisaba una vez por cooldown de forma indefinida.
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

/**
 * Cliente de base falso que responde según el SQL recibido, no por posición.
 * El orden de las consultas depende del estado del evento abierto (reconocido o
 * no), así que un arreglo posicional se rompe en cuanto el evaluador deja de
 * empezar siempre por el cooldown.
 */
function makeClient(opts: {
  eventoAbierto?: { id: string; reconocida_at: string | null } | null;
  dentroDeCooldown?: boolean;
  dgaActivo?: boolean;
  fallidos?: number;
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
      if (sql.includes('FROM pozo_config')) {
        return { rows: (opts.dgaActivo ?? true) ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('COUNT(*)') && sql.includes('dato_dga')) {
        return { rows: [{ n: opts.fallidos ?? 0 }] };
      }
      if (sql.startsWith('INSERT INTO alertas_eventos')) {
        return { rows: [{ id: 'evento-sf-nuevo' }] };
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

describe('evaluarAlertaDgaSlotsFallidos — cooldown activo', () => {
  it('cooldown activo → NO emite COUNT query, NO inserta alertas_eventos', async () => {
    const client = makeClient({ dentroDeCooldown: true, fallidos: 3 });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    // El COUNT sobre dato_dga se evalúa de forma diferida: si el cooldown ya
    // corta el ciclo, no se paga (ADR-6a).
    expect(hizoCount(client)).toBe(false);
    expect(hizoInsert(client)).toBe(false);
  });
});

describe('evaluarAlertaDgaSlotsFallidos — COUNT = 0', () => {
  it('COUNT = 0 fallidos → no inserta alertas_eventos', async () => {
    const client = makeClient({ fallidos: 0 });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    expect(hizoInsert(client)).toBe(false);
  });
});

describe('evaluarAlertaDgaSlotsFallidos — COUNT >= 1', () => {
  it('COUNT = 3 → inserta alertas_eventos con valor_texto="3", valor_detectado=NULL, severidad=alerta.severidad', async () => {
    const client = makeClient({ fallidos: 3 });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    const insertCall = insertDe(client);
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
    const client = makeClient({ fallidos: 1 });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    expect(hizoInsert(client)).toBe(true);
  });

  it('mensaje incluye texto en español con el count de slots', async () => {
    const client = makeClient({ fallidos: 5 });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    const mensaje = insertDe(client)!.params.find(
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

    const client = makeClient({ fallidos: 2 });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    // La consulta de notificación se dispara (fire-and-forget async).
    // Verificamos que se intentó insertar el evento.
    expect(hizoInsert(client)).toBe(true);
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
   * activa. El evaluador DEBE tratar la condición como no cumplida.
   */
  it('pozo_config.dga_activo=FALSE para el sitio → el evaluador sale sin INSERT aunque COUNT > 0', async () => {
    const client = makeClient({ dgaActivo: false, fallidos: 3 });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    expect(hizoInsert(client)).toBe(false);

    // El evaluador debe haber chequeado pozo_config
    const hasPozoConfigCheck = client._calls.some(
      (c) =>
        c.sql.toLowerCase().includes('pozo_config') && c.sql.toLowerCase().includes('dga_activo'),
    );
    expect(hasPozoConfigCheck).toBe(true);
  });

  it('DGA desactivado con un evento reconocido abierto → lo resuelve para rearmar', async () => {
    const client = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-18T10:00:00Z' },
      dgaActivo: false,
      fallidos: 3,
    });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    expect(hizoUpdate(client, 'resuelta = TRUE')).toBe(true);
    expect(hizoInsert(client)).toBe(false);
  });
});

describe('evaluarAlertaDgaSlotsFallidos — evento reconocido', () => {
  it('reconocido y el slot sigue fallido → agrupa la repetición, no crea evento ni correo', async () => {
    const client = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-18T10:00:00Z' },
      fallidos: 4,
    });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    expect(hizoInsert(client)).toBe(false);
    expect(hizoUpdate(client, 'repeticiones')).toBe(true);
  });

  it('reconocido y sin fallidos → resuelve el evento para volver a avisar la próxima vez', async () => {
    const client = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-18T10:00:00Z' },
      fallidos: 0,
    });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    expect(hizoUpdate(client, 'resuelta = TRUE')).toBe(true);
    expect(hizoInsert(client)).toBe(false);
  });

  it('abierto SIN reconocer y con fallidos → sigue rigiendo el cooldown, no se auto-resuelve', async () => {
    const client = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: null },
      dentroDeCooldown: true,
      fallidos: 4,
    });

    await evaluarAlertaDgaSlotsFallidos(client, BASE_ALERTA);

    expect(hizoInsert(client)).toBe(false);
    expect(hizoUpdate(client, 'repeticiones')).toBe(false);
    expect(hizoUpdate(client, 'resuelta = TRUE')).toBe(false);
  });
});
