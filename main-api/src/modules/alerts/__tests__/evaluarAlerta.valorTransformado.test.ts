/**
 * El umbral de una regla se compara contra el valor TRANSFORMADO por el
 * reg_map (el que muestra el dashboard), no contra el crudo del payload. Y el
 * correo va a los destinatarios elegidos en la regla, no a una lista fija.
 *
 * Caso real: S127 (Agrosuper) manda el caudal como IEEE754 en dos registros
 * (REG3003/REG3004, word_swap). Crudo 16609/16981 = 53,31 L/s. Una regla
 * "caudal > 50 L/s" tiene que disparar; con el crudo (16609) cualquier umbral
 * razonable disparaba siempre o nunca.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    workers: { alerts: false },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const queryMock = vi.fn(async () => ({ rows: [] }));
vi.mock('../../../config/dbHelpers', () => ({
  query: (...args: unknown[]) => queryMock(...(args as [])),
  getClient: vi.fn(),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { evaluarAlerta } from '../worker';

const caudalMapping = {
  id: 'RM87702B71',
  sitio_id: 'S127',
  alias: 'REG3003',
  d1: 'REG3003',
  d2: 'REG3004',
  tipo_dato: 'FLOAT',
  unidad: 'L/s',
  rol_dashboard: 'caudal',
  transformacion: 'ieee754_32',
  parametros: { factor: 1, offset: 0, formato: 'float32', word_swap: true },
};

const crudoS127 = { AI24: 187, REG3001: 40035, REG3002: 18399, REG3003: 16609, REG3004: 16981 };

function makeAlerta(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alerta-1',
    nombre: 'Caudal alto',
    empresa_id: 'E113',
    sub_empresa_id: 'SE115',
    sitio_id: 'S127',
    creado_por: 'SA001',
    variable_key: 'REG3003',
    condicion: 'mayor_que',
    umbral_bajo: 50,
    umbral_alto: null,
    severidad: 'media',
    cooldown_minutos: 5,
    dias_activos: null,
    notificar_user_ids: [] as string[],
    notificar_superadmins: true,
    id_serial: '151.21.36.25',
    sitio_desc: 'Pozo 2',
    ...overrides,
  };
}

/**
 * Cliente falso que responde según la tabla consultada: el crudo del equipo,
 * el mapeo del reg_map y un id para el INSERT del evento. Todo lo demás
 * (evento abierto, cooldown) devuelve cero filas.
 */
function makeClient({ mapping, data }: { mapping: unknown | null; data: Record<string, unknown> }) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    _calls: calls,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM equipo/.test(sql)) return { rows: [{ data }] };
      if (/FROM reg_map/.test(sql)) return { rows: mapping ? [mapping] : [] };
      if (/INSERT INTO alertas_eventos/.test(sql)) return { rows: [{ id: 'evt-1' }] };
      return { rows: [] };
    }),
  };
  return client;
}

function eventoInsertado(client: ReturnType<typeof makeClient>) {
  return client._calls.find((c) => /INSERT INTO alertas_eventos/.test(c.sql));
}

beforeEach(() => {
  queryMock.mockClear();
});

describe('evaluarAlerta — valor transformado por el reg_map', () => {
  it('compara el umbral contra el valor transformado (53,31 L/s > 50 dispara)', async () => {
    const client = makeClient({ mapping: caudalMapping, data: crudoS127 });
    await evaluarAlerta(client, makeAlerta({ umbral_bajo: 50 }));

    const ins = eventoInsertado(client);
    expect(ins).toBeDefined();
    // valor_detectado es el transformado, no la palabra cruda 16609.
    const valorDetectado = Number(ins!.params[5]);
    expect(valorDetectado).toBeCloseTo(53.31, 2);
  });

  it('con el umbral por encima del valor transformado no dispara, aunque el crudo sea enorme', async () => {
    const client = makeClient({ mapping: caudalMapping, data: crudoS127 });
    await evaluarAlerta(client, makeAlerta({ umbral_bajo: 60 }));
    expect(eventoInsertado(client)).toBeUndefined();
  });

  it('sin mapeo en el reg_map sigue comparando el crudo (retrocompatible)', async () => {
    const client = makeClient({ mapping: null, data: { AI23: 264 } });
    await evaluarAlerta(client, makeAlerta({ variable_key: 'AI23', umbral_bajo: 200 }));
    const ins = eventoInsertado(client);
    expect(ins).toBeDefined();
    expect(Number(ins!.params[5])).toBe(264);
  });

  it('si la transformacion falla (falta el segundo registro) no evalua ni inventa un valor', async () => {
    const client = makeClient({ mapping: caudalMapping, data: { REG3003: 16609 } });
    await evaluarAlerta(client, makeAlerta({ umbral_bajo: 0 }));
    expect(eventoInsertado(client)).toBeUndefined();
  });
});

describe('evaluarAlerta — destinatarios del correo', () => {
  function paramsNotificacion() {
    const call = queryMock.mock.calls.find((c) => /FROM usuario/.test(String(c[0])));
    return call ? (call[1] as unknown[]) : null;
  }

  it('avisa a los usuarios elegidos y al equipo Emeltec cuando la regla lo pide', async () => {
    const client = makeClient({ mapping: caudalMapping, data: crudoS127 });
    await evaluarAlerta(
      client,
      makeAlerta({ notificar_user_ids: ['U001', 'U002'], notificar_superadmins: true }),
    );
    await new Promise((r) => setTimeout(r, 0)); // notificarUsuarios corre sin await
    expect(paramsNotificacion()).toEqual(['SA001', true, ['U001', 'U002']]);
  });

  it('puede dejar fuera al equipo Emeltec', async () => {
    const client = makeClient({ mapping: caudalMapping, data: crudoS127 });
    await evaluarAlerta(
      client,
      makeAlerta({ notificar_user_ids: ['U001'], notificar_superadmins: false }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(paramsNotificacion()).toEqual(['SA001', false, ['U001']]);
  });

  it('sin destinatarios conserva el comportamiento historico: creador (+ SuperAdmin)', async () => {
    const client = makeClient({ mapping: caudalMapping, data: crudoS127 });
    await evaluarAlerta(
      client,
      makeAlerta({ notificar_user_ids: null, notificar_superadmins: null }),
    );
    await new Promise((r) => setTimeout(r, 0));
    // Lista vacia → la query cae en `cardinality = 0 AND id = creado_por`.
    expect(paramsNotificacion()).toEqual(['SA001', true, []]);
  });
});
