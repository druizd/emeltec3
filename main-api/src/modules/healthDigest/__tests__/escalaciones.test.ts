/**
 * Escalaciones del monitoreo: un correo por destinatario, no uno por
 * instalación, y nada de vaciar la bandeja al arrancar.
 *
 * El 16-09-2026 el container tomó `ENABLE_HEALTH_DIGEST_WORKER=true` y el
 * primer ciclo mandó un correo por cada instalación que ya venía caída. Eso es
 * lo que se prueba acá.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../config/heartbeat', () => ({ beat: vi.fn() }));
vi.mock('../repo', () => ({
  getDataTransmissionLag: vi.fn(),
  getDgaUsersForMonitoring: vi.fn(),
}));
vi.mock('../destinatariosRepo', () => ({ listDestinatariosActivos: vi.fn() }));

// emailService es CommonJS y entra por `require()`, que no pasa por el loader
// de vitest: `vi.mock` no lo intercepta. Reemplazar la entrada de
// `require.cache` tampoco sirve — el worker ya hizo su `require()` al
// importarse, y los imports se evalúan antes que este cuerpo. Lo que sí
// funciona es mutar la propiedad del MISMO objeto de módulo que el worker se
// guardó.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../../services/emailService.js') as Record<string, unknown>;
const sendHealthDigest = vi.fn().mockResolvedValue(undefined);
emailMod.sendHealthDigest = sendHealthDigest;

import { getDataTransmissionLag, getDgaUsersForMonitoring } from '../repo';
import { listDestinatariosActivos } from '../destinatariosRepo';
import { _resetEstadoInterno, detectarEscalaciones, runCycle, type IssueRow } from '../worker';

const H = 3_600_000;

function fila(id: string, horas: number, kind: 'data' | 'dga' = 'data'): IssueRow {
  return {
    kind,
    id,
    siteId: id,
    descripcion: `Pozo ${id}`,
    empresa: 'CCU',
    lagMs: horas * H,
    tier: horas >= 12 ? 't12' : horas >= 6 ? 't6' : horas >= 3 ? 't3' : 'ok',
    lastAt: new Date(Date.now() - horas * H).toISOString(),
  };
}

const destinatario = (email: string, umbral: 't3' | 't6' | 't12' = 't3') => ({
  email,
  nombre: null,
  recibe_resumen: true,
  recibe_eventos: true,
  recibe_seguridad: false,
  umbral_evento: umbral,
  activo: true,
  updated_at: null,
});

beforeEach(() => {
  sendHealthDigest.mockClear();
  _resetEstadoInterno();
  vi.mocked(getDgaUsersForMonitoring).mockResolvedValue([]);
  vi.mocked(listDestinatariosActivos).mockResolvedValue([destinatario('druiz@emeltec.cl')]);
});

describe('detectarEscalaciones', () => {
  it('marca el tier nuevo y no repite el mismo salto en el ciclo siguiente', () => {
    const snap = { data: [fila('S127', 7), fila('S128', 1)], dga: [] };
    expect(detectarEscalaciones(snap).map((r) => r.id)).toEqual(['S127']);
    // Segundo ciclo con el mismo estado: ya no es noticia.
    expect(detectarEscalaciones(snap)).toEqual([]);
  });

  it('vuelve a avisar cuando el mismo sitio sube de tramo', () => {
    expect(detectarEscalaciones({ data: [fila('S127', 7)], dga: [] })).toHaveLength(1);
    expect(detectarEscalaciones({ data: [fila('S127', 13)], dga: [] })).toHaveLength(1);
  });

  it('un sitio que recupera vuelve a cero y puede escalar de nuevo', () => {
    detectarEscalaciones({ data: [fila('S127', 13)], dga: [] });
    detectarEscalaciones({ data: [fila('S127', 0)], dga: [] });
    expect(detectarEscalaciones({ data: [fila('S127', 4)], dga: [] })).toHaveLength(1);
  });
});

describe('primer ciclo tras arrancar', () => {
  it('no manda correo por lo que ya venía caído: solo ceba el estado', async () => {
    vi.mocked(getDataTransmissionLag).mockResolvedValue(
      ['S127', 'S128', 'S129', 'S130'].map((id) => ({
        site_id: id,
        descripcion: `Pozo ${id}`,
        empresa_nombre: 'CCU',
        last_received_at: new Date(Date.now() - 20 * H).toISOString(),
      })) as never,
    );

    // estado limpio por `_resetEstadoInterno` en beforeEach
    await runCycle();

    expect(sendHealthDigest).not.toHaveBeenCalled();
  });

  it('lo que escala DESPUÉS del arranque sí avisa, en un solo correo', async () => {
    vi.mocked(getDataTransmissionLag).mockResolvedValue([] as never);
    // estado limpio por `_resetEstadoInterno` en beforeEach
    await runCycle(); // ciclo de cebado, nada caído

    vi.mocked(getDataTransmissionLag).mockResolvedValue(
      ['S127', 'S128', 'S129'].map((id) => ({
        site_id: id,
        descripcion: `Pozo ${id}`,
        empresa_nombre: 'CCU',
        last_received_at: new Date(Date.now() - 7 * H).toISOString(),
      })) as never,
    );
    await runCycle();

    expect(sendHealthDigest).toHaveBeenCalledTimes(1);
    const input = sendHealthDigest.mock.calls[0]![0];
    expect(input.to).toBe('druiz@emeltec.cl');
    expect(input.mode).toBe('escalaciones');
    expect(input.dataIssues).toHaveLength(3);
  });

  it('una sola escalación sigue mandando el correo de detalle', async () => {
    vi.mocked(getDataTransmissionLag).mockResolvedValue([] as never);
    // estado limpio por `_resetEstadoInterno` en beforeEach
    await runCycle();

    vi.mocked(getDataTransmissionLag).mockResolvedValue([
      {
        site_id: 'S149',
        descripcion: 'Kross',
        empresa_nombre: 'Kross',
        last_received_at: new Date(Date.now() - 13 * H).toISOString(),
      },
    ] as never);
    await runCycle();

    expect(sendHealthDigest).toHaveBeenCalledTimes(1);
    expect(sendHealthDigest.mock.calls[0]![0].mode).toBe('event');
  });

  it('cada destinatario recibe un correo con lo que le toca por su umbral', async () => {
    vi.mocked(listDestinatariosActivos).mockResolvedValue([
      destinatario('todo@emeltec.cl', 't3'),
      destinatario('solo-grave@emeltec.cl', 't12'),
    ]);
    vi.mocked(getDataTransmissionLag).mockResolvedValue([] as never);
    // estado limpio por `_resetEstadoInterno` en beforeEach
    await runCycle();

    vi.mocked(getDataTransmissionLag).mockResolvedValue([
      {
        site_id: 'S127',
        descripcion: 'Pozo 2',
        empresa_nombre: 'Agrosuper',
        last_received_at: new Date(Date.now() - 4 * H).toISOString(),
      },
      {
        site_id: 'S128',
        descripcion: 'Pozo 1',
        empresa_nombre: 'Agrosuper',
        last_received_at: new Date(Date.now() - 20 * H).toISOString(),
      },
    ] as never);
    await runCycle();

    expect(sendHealthDigest).toHaveBeenCalledTimes(2);
    const porDestino = Object.fromEntries(
      sendHealthDigest.mock.calls.map(([i]) => [i.to, i]) as Array<
        [string, { mode: string; dataIssues?: IssueRow[]; eventDetail?: IssueRow }]
      >,
    );
    expect(porDestino['todo@emeltec.cl']!.mode).toBe('escalaciones');
    expect(porDestino['todo@emeltec.cl']!.dataIssues).toHaveLength(2);
    // El de umbral 12h solo se entera del grave, y con el correo de detalle.
    expect(porDestino['solo-grave@emeltec.cl']!.mode).toBe('event');
    expect(porDestino['solo-grave@emeltec.cl']!.eventDetail!.siteId).toBe('S128');
  });
});
