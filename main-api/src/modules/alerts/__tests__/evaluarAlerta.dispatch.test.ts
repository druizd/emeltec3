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

/**
 * Cliente de base falso que devuelve cero filas para todo. Estos tests solo
 * miran el ruteo, así que el evaluador específico corre completo y termina sin
 * disparar: no hay evento abierto, no hay cooldown y no hay filas en dato_dga.
 * Lo que se verifica es que nunca se consulte `equipo`.
 */
function makeClient() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    _calls: calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    }),
  };
  return client;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('evaluarAlerta — dispatch dga_slots_fallidos', () => {
  it('condicion=dga_slots_fallidos no ejecuta ninguna consulta a FROM equipo', async () => {
    const client = makeClient();

    await evaluarAlerta(client, makeAlerta('dga_slots_fallidos'));

    const hasEquipoQuery = client._calls.some((c) => /FROM equipo/i.test(c.sql));
    expect(hasEquipoQuery).toBe(false);
  });

  it('condicion=dga_slots_fallidos retorna (no llega al cooldown genérico de equipo)', async () => {
    const client = makeClient();

    await evaluarAlerta(client, makeAlerta('dga_slots_fallidos'));

    // El evaluador específico maneja su propio estado de evento y cooldown;
    // en cualquier caso, equipo no debe aparecer.
    const hasEquipoQuery = client._calls.some((c) => /FROM equipo/i.test(c.sql));
    expect(hasEquipoQuery).toBe(false);
  });
});

describe('evaluarAlerta — dispatch review_queue_acumulacion', () => {
  it('condicion=review_queue_acumulacion no ejecuta ninguna consulta a FROM equipo', async () => {
    // umbral_bajo = 5 → válido, así que el evaluador corre y no debe tocar equipo.
    const alerta = { ...makeAlerta('review_queue_acumulacion'), umbral_bajo: 5 };
    const client = makeClient();

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
    const client = makeClient();

    await evaluarAlerta(client, alerta);

    expect(client._calls).toHaveLength(0);
  });
});
