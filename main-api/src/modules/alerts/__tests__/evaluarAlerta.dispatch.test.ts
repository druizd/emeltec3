/**
 * Tests de dispatch routing en evaluarAlerta().
 *
 * Spec: §"Worker Dispatch Routing" — nuevas condiciones deben rutear a sus
 * evaluadores específicos y NO alcanzar la ruta genérica de equipo.
 * ADR-6: los branches de early-return son ANTERIORES al cooldown genérico
 * y a la consulta a equipo.
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

import { evaluarAlerta } from '../worker';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAlerta(condicion: string) {
  return {
    id: 'alerta-dispatch-1',
    nombre: 'Dispatch Test',
    empresa_id: 'emp-1',
    sub_empresa_id: null,
    sitio_id: 'sitio-1',
    creado_por: 'user-1',
    variable_key: 'nivel',
    condicion,
    umbral_bajo: 5,
    umbral_alto: 100,
    severidad: 'media',
    cooldown_minutos: 120,
    // dias_activos = null → estaActivoHoy() = true
    dias_activos: null,
    id_serial: 'SERIAL-01',
    sitio_desc: 'Pozo Test',
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

describe('evaluarAlerta — dispatch dga_slots_fallidos', () => {
  it('condicion=dga_slots_fallidos no ejecuta ninguna consulta a FROM equipo', async () => {
    // El evaluador de slots fallidos hará: cooldown + COUNT (dato_dga) + posible INSERT.
    // Asignamos respuestas para que retorne limpiamente (cooldown activo → early return).
    const client = makeClient([
      { rows: [{ triggered_at: new Date().toISOString() }] }, // cooldown activo
    ]);

    await evaluarAlerta(client, makeAlerta('dga_slots_fallidos'));

    const hasEquipoQuery = client._calls.some((c) => /FROM equipo/i.test(c.sql));
    expect(hasEquipoQuery).toBe(false);
  });

  it('condicion=dga_slots_fallidos retorna (no llega al cooldown genérico de equipo)', async () => {
    // Con cooldown activo, solo 1 llamada: la de cooldown del evaluador.
    const client = makeClient([
      { rows: [{ triggered_at: new Date().toISOString() }] },
    ]);

    await evaluarAlerta(client, makeAlerta('dga_slots_fallidos'));

    // La consulta de cooldown genérico de equipo usa DISTINTO SQL que el cooldown del evaluador;
    // en cualquier caso, equipo no debe aparecer.
    const hasEquipoQuery = client._calls.some((c) => /FROM equipo/i.test(c.sql));
    expect(hasEquipoQuery).toBe(false);
  });
});

describe('evaluarAlerta — dispatch review_queue_acumulacion', () => {
  it('condicion=review_queue_acumulacion no ejecuta ninguna consulta a FROM equipo', async () => {
    // umbral_bajo = 5 → válido; cooldown activo → early return sin COUNT.
    const alerta = { ...makeAlerta('review_queue_acumulacion'), umbral_bajo: 5 };
    const client = makeClient([
      { rows: [{ triggered_at: new Date().toISOString() }] }, // cooldown activo
    ]);

    await evaluarAlerta(client, alerta);

    const hasEquipoQuery = client._calls.some((c) => /FROM equipo/i.test(c.sql));
    expect(hasEquipoQuery).toBe(false);
  });

  it('condicion=review_queue_acumulacion con umbral_bajo=null — no ejecuta ninguna consulta', async () => {
    const alerta = {
      ...makeAlerta('review_queue_acumulacion'),
      umbral_bajo: null as unknown as number,
    };
    // Con misconfig guard, no debe haber ninguna llamada a client.query
    const client = makeClient([]);

    await evaluarAlerta(client, alerta);

    expect(client._calls).toHaveLength(0);
  });
});
