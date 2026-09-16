/**
 * Alerta de desconexión: la ventana se mide en HORAS y el aviso dice cuánto
 * lleva caído el equipo.
 *
 * Antes la ventana era `cooldown_minutos` —el mismo número que hace de
 * anti-flapping— y el mensaje decía siempre "hace más de 60 minutos", aunque el
 * pozo llevara tres días mudo.
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

vi.mock('../../../config/dbHelpers', () => ({ query: vi.fn(), getClient: vi.fn() }));

vi.mock('../../../services/emailService.js', () => ({
  sendAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

import { buildMensaje, evaluarAlerta, horasSinDatos } from '../worker';

type Alerta = Parameters<typeof buildMensaje>[0];

function alertaSinDatos(over: Partial<Alerta> = {}): Alerta {
  return {
    id: 'A-sin-datos',
    nombre: 'Sin comunicación del equipo',
    empresa_id: 'E119',
    sub_empresa_id: null,
    sitio_id: 'S149',
    creado_por: 'U1',
    variable_key: 'equipo',
    condicion: 'sin_datos',
    umbral_bajo: 12,
    umbral_alto: null,
    severidad: 'alta',
    cooldown_minutos: 60,
    dias_activos: null,
    id_serial: '151.20.43.6',
    sitio_desc: 'Kross',
    ...over,
  } as Alerta;
}

describe('horasSinDatos', () => {
  it('toma la ventana de umbral_bajo, en horas', () => {
    expect(horasSinDatos(alertaSinDatos({ umbral_bajo: 12 }))).toBe(12);
    expect(horasSinDatos(alertaSinDatos({ umbral_bajo: 0.5 }))).toBe(0.5);
  });

  it('sin umbral cae al cooldown, como las reglas anteriores al cambio', () => {
    expect(horasSinDatos(alertaSinDatos({ umbral_bajo: null, cooldown_minutos: 90 }))).toBe(1.5);
  });

  it('un umbral inválido no deja la ventana en cero (avisaría en cada ciclo)', () => {
    expect(horasSinDatos(alertaSinDatos({ umbral_bajo: 0, cooldown_minutos: 60 }))).toBe(1);
    expect(horasSinDatos(alertaSinDatos({ umbral_bajo: -3, cooldown_minutos: 60 }))).toBe(1);
  });
});

describe('buildMensaje · sin_datos', () => {
  it('dice el tiempo real sin transmitir cuando se pudo calcular', () => {
    const msg = buildMensaje(alertaSinDatos(), null, '38h 12m');
    expect(msg).toContain('no transmite hace 38h 12m');
    expect(msg).toContain('umbral 12 h');
  });

  it('sin el dato real, informa el umbral', () => {
    expect(buildMensaje(alertaSinDatos(), null)).toContain('hace más de 12 h');
  });
});

describe('evaluarAlerta · sin_datos', () => {
  it('consulta la ventana en minutos derivada de las horas, no el cooldown', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        // Hay datos recientes → no dispara, y el test se queda en la consulta.
        if (sql.includes('FROM equipo')) return { rows: [{ time: new Date().toISOString() }] };
        return { rows: [] };
      }),
    };

    await evaluarAlerta(client, alertaSinDatos({ umbral_bajo: 12, cooldown_minutos: 60 }));

    const ventana = queries.find((q) => q.sql.includes('FROM equipo'));
    expect(ventana).toBeDefined();
    // 12 h = 720 min. Con el cooldown habrían sido 60.
    expect(ventana!.params).toContain('720');
  });
});
