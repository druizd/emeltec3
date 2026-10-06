/**
 * La última lectura de `equipo` que evalúan las alertas va acotada en el
 * tiempo: primero 7 días y, si no hay nada, solo el chunk del último día con
 * datos según `equipo_daily`. El resultado tiene que ser el mismo que daba el
 * `ORDER BY time DESC LIMIT 1` sin cota, solo que sin recorrer todos los chunks.
 */
import { describe, expect, it, vi } from 'vitest';

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
  query: vi.fn(async () => ({ rows: [] })),
  getClient: vi.fn(),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { evaluarAlerta } from '../worker';

function makeAlerta() {
  return {
    id: 'alerta-1',
    nombre: 'Nivel alto',
    empresa_id: 'E1',
    sub_empresa_id: 'SE1',
    sitio_id: 'S1',
    creado_por: 'SA001',
    variable_key: 'nivel',
    condicion: 'mayor_que',
    umbral_bajo: 50,
    umbral_alto: null,
    severidad: 'media',
    cooldown_minutos: 5,
    dias_activos: null,
    notificar_user_ids: [] as string[],
    notificar_superadmins: true,
    id_serial: '151.21.36.25',
    sitio_desc: 'Pozo 1',
  };
}

type Fila = Record<string, unknown>;

function makeClient({
  recent = [],
  buckets = [],
  fallback = [],
}: {
  recent?: Fila[];
  buckets?: Fila[];
  fallback?: Fila[];
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    _calls: calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM equipo_daily/.test(sql)) return { rows: buckets };
      if (/FROM equipo\b/.test(sql)) {
        return { rows: /INTERVAL '7 days'/.test(sql) ? recent : fallback };
      }
      if (/INSERT INTO alertas_eventos/.test(sql)) return { rows: [{ id: 'evt-1' }] };
      return { rows: [] };
    }),
  };
  return client;
}

const consultasEquipo = (c: ReturnType<typeof makeClient>) =>
  c._calls.filter((x) => /FROM equipo\b/.test(x.sql));
const evento = (c: ReturnType<typeof makeClient>) =>
  c._calls.find((x) => /INSERT INTO alertas_eventos/.test(x.sql));

describe('evaluarAlerta — lectura acotada de equipo', () => {
  it('con datos recientes evalúa la fila con una sola consulta acotada a 7 días', async () => {
    const client = makeClient({ recent: [{ data: { nivel: 80 } }] });
    await evaluarAlerta(client, makeAlerta());

    expect(consultasEquipo(client)).toHaveLength(1);
    expect(consultasEquipo(client)[0]!.sql).toMatch(/time >= NOW\(\) - INTERVAL '7 days'/);
    expect(client._calls.some((c) => /equipo_daily/.test(c.sql))).toBe(false);
    expect(evento(client)).toBeDefined();
  });

  it('sin datos en 7 días usa equipo_daily y lee solo el chunk del último día', async () => {
    const bucket = new Date('2026-08-01T00:00:00Z');
    const client = makeClient({
      buckets: [{ bucket }],
      fallback: [{ data: { nivel: 80 } }],
    });
    await evaluarAlerta(client, makeAlerta());

    const diaria = client._calls.find((c) => /FROM equipo_daily/.test(c.sql));
    expect(diaria!.params).toEqual(['151.21.36.25']);
    const lectura = consultasEquipo(client).at(-1)!;
    expect(lectura.sql).toMatch(/time >= \$2/);
    expect(lectura.sql).toMatch(/time < {2}\$2 \+ INTERVAL '1 day'/);
    expect(lectura.params).toEqual(['151.21.36.25', bucket]);
    // Evalúa la misma fila vieja que habría devuelto la consulta sin cota.
    expect(evento(client)).toBeDefined();
  });

  it('sin ningún dato del serial no evalúa ni dispara nada', async () => {
    const client = makeClient({});
    await evaluarAlerta(client, makeAlerta());

    expect(client._calls.some((c) => /FROM equipo_daily/.test(c.sql))).toBe(true);
    expect(consultasEquipo(client)).toHaveLength(1);
    expect(evento(client)).toBeUndefined();
  });

  it('con bucket pero sin fila en ese día tampoco dispara', async () => {
    const client = makeClient({ buckets: [{ bucket: '2026-08-01T00:00:00Z' }] });
    await evaluarAlerta(client, makeAlerta());
    expect(evento(client)).toBeUndefined();
  });
});
