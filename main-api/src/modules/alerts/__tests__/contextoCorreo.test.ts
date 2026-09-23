/**
 * El contexto que llega al correo desde los evaluadores especializados.
 *
 * `sendAlertEmail` arma la fila "Sitio" con `sitio_etiqueta || sitio_desc ||
 * sitio_id`, y el botón con `sitio_url || ACCESS_URL`. Los cuatro evaluadores
 * especializados no ponían ninguno de los dos, así que las alertas DGA —las
 * que más contexto necesitan— llegaban con "Pozo 4" en vez de
 * "CCU · Quilicura · Pozo 4 · OB-1306-98" y con el botón a la pantalla de
 * login.
 *
 * Se testea a través del evaluador y no de `contextoCorreo` directamente: lo
 * que se rompió no fue el helper (no existía), sino que cada evaluador se
 * olvidara de armar esos dos campos.
 *
 * emailService se sustituye vía `require.cache`, NO con `vi.mock`: el worker lo
 * carga con `require()` y ese require pasa por el loader de Node, que vitest no
 * parchea. Con `vi.mock` el spy nunca se llamaba —verificado— y el test daba un
 * falso rojo. Mismo motivo que `internalController.fallo.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Solo tipos: se borran al compilar, así que no alteran el orden de carga que
// `vi.hoisted` necesita.
import type * as NodeModule from 'node:module';
import type * as NodePath from 'node:path';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    workers: { alerts: false },
    alertas: { emeltecEmails: ['guardia@emeltec.cl'] },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

/** Corre ANTES de los imports: el worker resuelve emailService al cargarse. */
const correos = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodePath = require('node:path') as typeof NodePath;
  const { createRequire } = require('node:module') as typeof NodeModule;
  /* eslint-enable @typescript-eslint/no-require-imports */
  // cwd es la raíz del paquete al correr los tests. Si no lo fuera, `resolve`
  // lanza en vez de fallar en silencio.
  const req = createRequire(nodePath.join(process.cwd(), 'vitest-require-root.js'));
  const ruta = req.resolve('./src/services/emailService');
  const enviados: unknown[][] = [];
  req.cache[ruta] = {
    id: ruta,
    filename: ruta,
    loaded: true,
    exports: {
      sendAlertEmail: async (...args: unknown[]) => {
        enviados.push(args);
      },
    },
  } as NodeJS.Module;
  return enviados;
});

import { query } from '../../../config/dbHelpers';
import { evaluarAlertaDgaSlotsFallidos, evaluarAlertaReviewQueue } from '../worker';

const queryMock = query as unknown as ReturnType<typeof vi.fn>;

/** Una regla sobre un pozo de CCU, con todo el contexto que trae el ciclo. */
const BASE_ALERTA = {
  id: 'alerta-ctx-1',
  nombre: 'Slots DGA fallidos',
  empresa_id: 'E100',
  sub_empresa_id: 'SE1',
  sitio_id: 'S140',
  creado_por: 'user-1',
  variable_key: 'dga',
  condicion: 'dga_slots_fallidos' as const,
  umbral_bajo: 0,
  umbral_alto: 0,
  severidad: 'alta',
  cooldown_minutos: 120,
  dias_activos: null,
  id_serial: '151.20.43.6',
  sitio_desc: 'Pozo 4',
  tipo_sitio: 'agua',
  empresa_nombre: 'CCU',
  sub_empresa_nombre: 'Quilicura',
  obra_dga: 'OB-1306-98',
};

const ETIQUETA = 'CCU · Quilicura · Pozo 4 · OB-1306-98';

function makeClient(n = 3) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM alertas_eventos') && sql.includes('resuelta = FALSE')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT 1 FROM alertas_eventos')) return { rows: [] };
      if (sql.includes('FROM pozo_config')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('COUNT(*)') && sql.includes('dato_dga')) return { rows: [{ n }] };
      if (sql.startsWith('INSERT INTO alertas_eventos')) return { rows: [{ id: 'evento-1' }] };
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  correos.length = 0;
  // `destinatariosDeAlerta` y el UPDATE de "notificado" pasan por este query.
  queryMock.mockResolvedValue({
    rows: [{ id: 'u1', email: 'cliente@ccu.cl', nombre: 'Pablo', apellido: 'Valenzuela' }],
  });
});

/** El correo sale fire-and-forget: hay que esperar el ciclo de eventos. */
async function reglaDelCorreo(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(correos.length).toBeGreaterThan(0));
  return correos[0]![3] as Record<string, unknown>;
}

describe('contexto del correo — dga_slots_fallidos', () => {
  it('manda la etiqueta completa del sitio, no solo la descripción', async () => {
    await evaluarAlertaDgaSlotsFallidos(makeClient(), BASE_ALERTA);
    expect((await reglaDelCorreo()).sitio_etiqueta).toBe(ETIQUETA);
  });

  it('manda el link al pozo, no a la pantalla de login', async () => {
    await evaluarAlertaDgaSlotsFallidos(makeClient(), BASE_ALERTA);
    const regla = await reglaDelCorreo();
    expect(regla.sitio_url).toContain('S140');
    expect(regla.sitio_url).toContain('tab=alertas');
  });

  it('el mensaje también lleva la etiqueta: viaja al correo Y a la bandeja', async () => {
    await evaluarAlertaDgaSlotsFallidos(makeClient(), BASE_ALERTA);
    await vi.waitFor(() => expect(correos.length).toBeGreaterThan(0));
    expect(correos[0]![2]).toContain(ETIQUETA);
  });
});

describe('contexto del correo — review_queue_acumulacion', () => {
  it('lleva etiqueta y link', async () => {
    const alerta = {
      ...BASE_ALERTA,
      condicion: 'review_queue_acumulacion' as const,
      umbral_bajo: 1,
    };
    await evaluarAlertaReviewQueue(makeClient(9), alerta);
    const regla = await reglaDelCorreo();
    expect(regla.sitio_etiqueta).toBe(ETIQUETA);
    expect(regla.sitio_url).toContain('tab=alertas');
  });
});
