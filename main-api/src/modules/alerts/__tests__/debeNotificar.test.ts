/**
 * Agrupación de repeticiones: reconocer un evento significa "ya lo sé".
 *
 * Antes el cooldown solo miraba `triggered_at` sin importar el estado del
 * evento, así que una condición que no se normaliza sola (un totalizador
 * acumulado, por ejemplo) generaba un evento y un correo cada 5 minutos
 * indefinidamente: 576 por fin de semana con el cooldown por defecto.
 *
 * Se prueba `evaluarAlerta` de punta a punta con un cliente de base falso, que
 * es donde vive la interacción entre condición, evento abierto y cooldown.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/dbHelpers', () => ({
  getClient: vi.fn(),
  query: vi.fn(),
}));
vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../config/appConfig', () => ({ config: { alerts: {} } }));
vi.mock('../../../services/emailService.js', () => ({ sendAlertEmail: vi.fn() }));

import { evaluarAlerta } from '../worker';

type Fila = Record<string, unknown>;

/** Cliente de base falso: responde según el SQL que recibe. */
function makeClient(opts: {
  eventoAbierto?: Fila | null;
  dentroDeCooldown?: boolean;
  valorCrudo?: unknown;
}) {
  const ejecutadas: { sql: string; params: unknown[] }[] = [];
  const client = {
    ejecutadas,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      ejecutadas.push({ sql, params });
      if (sql.includes('FROM alertas_eventos') && sql.includes('resuelta = FALSE')) {
        return { rows: opts.eventoAbierto ? [opts.eventoAbierto] : [] };
      }
      if (sql.includes('SELECT 1 FROM alertas_eventos')) {
        return { rows: opts.dentroDeCooldown ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('FROM equipo')) {
        return { rows: [{ data: { AI1: opts.valorCrudo ?? 500 } }] };
      }
      if (sql.startsWith('INSERT INTO alertas_eventos')) {
        return { rows: [{ id: 'EV-NUEVO' }] };
      }
      return { rows: [] };
    }),
  };
  return client;
}

const alerta = {
  id: '3',
  nombre: 'Consumo fin de semana',
  empresa_id: 'E1',
  sub_empresa_id: null,
  sitio_id: 'S106',
  creado_por: 'SA001',
  variable_key: 'AI1',
  condicion: 'mayor_que',
  umbral_bajo: 300,
  umbral_alto: null,
  severidad: 'alta',
  cooldown_minutos: 5,
  dias_activos: null, // null = todos los días
  id_serial: '151.20.35.3',
  sitio_desc: 'Vertiente 1',
} as never;

const sqlsDe = (c: ReturnType<typeof makeClient>) => c.ejecutadas.map((e) => e.sql);
const hizoInsert = (c: ReturnType<typeof makeClient>) =>
  sqlsDe(c).some((s) => s.startsWith('INSERT INTO alertas_eventos'));
const hizoUpdate = (c: ReturnType<typeof makeClient>, frag: string) =>
  sqlsDe(c).some((s) => s.includes('UPDATE alertas_eventos') && s.includes(frag));

beforeEach(() => vi.clearAllMocks());

describe('evento reconocido — se agrupa en vez de repetir', () => {
  it('no crea evento nuevo si el abierto ya fue reconocido', async () => {
    const c = makeClient({ eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-22T10:00:00Z' } });

    await evaluarAlerta(c, alerta);

    expect(hizoInsert(c)).toBe(false);
    expect(hizoUpdate(c, 'repeticiones')).toBe(true);
  });

  it('el contador de repeticiones se incrementa sobre el evento reconocido', async () => {
    const c = makeClient({ eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-22T10:00:00Z' } });

    await evaluarAlerta(c, alerta);

    const upd = c.ejecutadas.find((e) => e.sql.includes('repeticiones'));
    expect(upd?.sql).toContain('repeticiones = repeticiones + 1');
    expect(upd?.sql).toContain('ultima_repeticion_at = NOW()');
    expect(upd?.params).toEqual(['EV1']);
  });
});

describe('rearme cuando la condición se normaliza', () => {
  it('resuelve el evento reconocido para volver a avisar la próxima vez', async () => {
    // 100 no supera el umbral de 300.
    const c = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: '2026-08-22T10:00:00Z' },
      valorCrudo: 100,
    });

    await evaluarAlerta(c, alerta);

    expect(hizoUpdate(c, 'resuelta = TRUE')).toBe(true);
    expect(hizoInsert(c)).toBe(false);
  });

  it('un evento SIN reconocer no se auto-resuelve: alguien tiene que verlo', async () => {
    const c = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: null },
      valorCrudo: 100,
    });

    await evaluarAlerta(c, alerta);

    expect(hizoUpdate(c, 'resuelta = TRUE')).toBe(false);
    expect(hizoInsert(c)).toBe(false);
  });
});

describe('sin reconocer — sigue rigiendo el cooldown', () => {
  it('dentro del cooldown no crea evento', async () => {
    const c = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: null },
      dentroDeCooldown: true,
    });

    await evaluarAlerta(c, alerta);

    expect(hizoInsert(c)).toBe(false);
    expect(hizoUpdate(c, 'repeticiones')).toBe(false);
  });

  it('fuera del cooldown crea el evento y notifica', async () => {
    const c = makeClient({
      eventoAbierto: { id: 'EV1', reconocida_at: null },
      dentroDeCooldown: false,
    });

    await evaluarAlerta(c, alerta);

    expect(hizoInsert(c)).toBe(true);
  });

  it('sin ningún evento abierto, dispara normalmente', async () => {
    const c = makeClient({ eventoAbierto: null, dentroDeCooldown: false });

    await evaluarAlerta(c, alerta);

    expect(hizoInsert(c)).toBe(true);
  });
});
