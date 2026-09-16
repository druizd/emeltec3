/**
 * Resumen interno de monitoreo: dos veces al día, dos secciones, y el slot no
 * se pierde.
 *
 * El envío exigía que un ciclo cayera en el minuto 0 exacto. El `setInterval`
 * de 60 s deriva con el trabajo de cada ciclo, así que en cuanto un tick pasaba
 * de `05:59:5x` a `06:01:0x` el resumen del día no salía y nadie se enteraba:
 * "se guarda la configuración y no llega ningún correo".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../config/heartbeat', () => ({ beat: vi.fn() }));
vi.mock('../../../config/dbHelpers', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../repo', () => ({
  getDataTransmissionLag: vi.fn(),
  getDgaUsersForMonitoring: vi.fn(),
}));
vi.mock('../destinatariosRepo', () => ({ listDestinatariosActivos: vi.fn() }));
vi.mock('../configRepo', () => ({ getConfig: vi.fn() }));

// emailService es CommonJS y entra por `require()`, que no pasa por el loader
// de vitest: `vi.mock` no lo intercepta, y reemplazar `require.cache` tampoco
// sirve porque el worker ya hizo su `require()` al importarse. Se muta la
// propiedad del MISMO objeto de módulo que el worker se guardó.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const emailMod = require('../../../services/emailService.js') as Record<string, unknown>;
const sendHealthDigest = vi.fn().mockResolvedValue(undefined);
emailMod.sendHealthDigest = sendHealthDigest;

import { getClient } from '../../../config/dbHelpers';
import { getDataTransmissionLag, getDgaUsersForMonitoring } from '../repo';
import { listDestinatariosActivos } from '../destinatariosRepo';
import { getConfig } from '../configRepo';
import { buildSnapshot, instanteDeParedChile, runCycle, slotsCumplidos } from '../worker';

const H = 3_600_000;

const destinatario = (email: string, recibeResumen = true) => ({
  email,
  nombre: null,
  recibe_resumen: recibeResumen,
  recibe_eventos: false,
  recibe_seguridad: false,
  umbral_evento: 't12' as const,
  activo: true,
  updated_at: null,
});

const equipo = (id: string, horasSinDatos: number | null) => ({
  site_id: id,
  descripcion: `Pozo ${id}`,
  empresa_nombre: 'CCU',
  id_serial: `SER-${id}`,
  tipo_sitio: 'pozo',
  last_received_at:
    horasSinDatos === null ? null : new Date(Date.now() - horasSinDatos * H).toISOString(),
});

/** Cliente de base falso: registra los slots reclamados. */
function fakeClient(slotsYaEnviados: string[] = []) {
  const reclamados: string[] = [];
  return {
    reclamados,
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO health_digest_envios')) {
        const slot = String(params[0]);
        if (slotsYaEnviados.includes(slot)) return { rows: [] };
        reclamados.push(slot);
        return { rows: [{ slot_ts: slot }] };
      }
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConfig).mockResolvedValue({ horas: [7, 16], umbralHoras: 6, updatedAt: null });
  vi.mocked(getDgaUsersForMonitoring).mockResolvedValue([]);
  vi.mocked(getDataTransmissionLag).mockResolvedValue([]);
  vi.mocked(listDestinatariosActivos).mockResolvedValue([destinatario('druiz@emeltec.cl')]);
});

describe('slotsCumplidos', () => {
  it('a las 07:05 de Chile el slot de las 07:00 está cumplido', () => {
    // Septiembre: sin horario de verano, Chile está en UTC-4.
    const now = new Date('2026-09-16T11:05:00Z');
    expect(slotsCumplidos(now, [7, 16])).toHaveLength(1);
  });

  it('el slot sobrevive a un ciclo que no cayó en el minuto exacto', () => {
    // 07:47 de Chile: el tick del minuto 0 se perdió por la deriva del
    // setInterval. Antes el resumen del día simplemente no salía.
    const now = new Date('2026-09-16T11:47:00Z');
    expect(slotsCumplidos(now, [7, 16])).toHaveLength(1);
  });

  it('pasadas dos horas ya no se rescata: el resumen atrasado no sirve', () => {
    const now = new Date('2026-09-16T14:05:00Z'); // 10:05 de Chile
    expect(slotsCumplidos(now, [7, 16])).toEqual([]);
  });

  it('la hora es de pared chilena, así que en verano no se corre sola', () => {
    // Enero (UTC-3) y julio (UTC-4): las 07:00 de pared en ambos casos.
    expect(instanteDeParedChile(2026, 1, 15, 7).toISOString()).toBe('2026-01-15T10:00:00.000Z');
    expect(instanteDeParedChile(2026, 7, 15, 7).toISOString()).toBe('2026-07-15T11:00:00.000Z');
  });
});

describe('buildSnapshot', () => {
  it('solo incluye equipos que pasaron el umbral, del peor al mejor', async () => {
    vi.mocked(getDataTransmissionLag).mockResolvedValue([
      equipo('S127', 2),
      equipo('S128', 30),
      equipo('S129', 8),
    ] as never);

    const snap = await buildSnapshot(6);

    expect(snap.data.map((r) => r.siteId)).toEqual(['S128', 'S129']);
  });

  it('un sitio sin ninguna transmisión registrada va primero, no último', async () => {
    vi.mocked(getDataTransmissionLag).mockResolvedValue([
      equipo('S128', 30),
      equipo('S149', null),
    ] as never);

    const snap = await buildSnapshot(6);

    expect(snap.data[0]!.siteId).toBe('S149');
  });

  it('cada fila trae el link al sitio', async () => {
    vi.mocked(getDataTransmissionLag).mockResolvedValue([equipo('S128', 30)] as never);

    const snap = await buildSnapshot(6);

    expect(snap.data[0]!.url).toContain('S128');
  });
});

describe('runCycle', () => {
  it('manda un correo por destinatario cuando el slot está cumplido', async () => {
    vi.mocked(getClient).mockResolvedValue(fakeClient() as never);
    vi.mocked(listDestinatariosActivos).mockResolvedValue([
      destinatario('druiz@emeltec.cl'),
      destinatario('nlira@emeltec.cl'),
    ]);
    vi.mocked(getDataTransmissionLag).mockResolvedValue([equipo('S128', 30)] as never);

    await runCycle(new Date('2026-09-16T11:05:00Z'));

    expect(sendHealthDigest).toHaveBeenCalledTimes(2);
    expect(sendHealthDigest.mock.calls[0]![0].dataIssues).toHaveLength(1);
    expect(sendHealthDigest.mock.calls[0]![0].umbralHoras).toBe(6);
  });

  it('manda igual cuando no hay nada: saber que el monitoreo está vivo importa', async () => {
    vi.mocked(getClient).mockResolvedValue(fakeClient() as never);

    await runCycle(new Date('2026-09-16T11:05:00Z'));

    expect(sendHealthDigest).toHaveBeenCalledTimes(1);
    expect(sendHealthDigest.mock.calls[0]![0].dataIssues).toEqual([]);
  });

  it('un slot ya enviado no se repite, aunque el ciclo lo vuelva a ver', async () => {
    const slot = instanteDeParedChile(2026, 9, 16, 7).toISOString();
    vi.mocked(getClient).mockResolvedValue(fakeClient([slot]) as never);

    await runCycle(new Date('2026-09-16T11:05:00Z'));

    expect(sendHealthDigest).not.toHaveBeenCalled();
  });

  it('fuera de horario no manda ni abre conexión', async () => {
    const client = fakeClient();
    vi.mocked(getClient).mockResolvedValue(client as never);

    await runCycle(new Date('2026-09-16T17:00:00Z')); // 13:00 de Chile

    expect(sendHealthDigest).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('quien no pidió el resumen no lo recibe', async () => {
    vi.mocked(getClient).mockResolvedValue(fakeClient() as never);
    vi.mocked(listDestinatariosActivos).mockResolvedValue([
      destinatario('solo-seguridad@emeltec.cl', false),
    ]);

    await runCycle(new Date('2026-09-16T11:05:00Z'));

    expect(sendHealthDigest).not.toHaveBeenCalled();
  });
});
