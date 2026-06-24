import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    dga: {
      gcs: {
        enabled: true,
        bucket: 'raw-reg-ind-tc-ext-emeltec-prod',
        batchMinutes: 60,
        keyFile: undefined,
        proveedor: 'EMELTEC',
      },
    },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/heartbeat', () => ({ beat: vi.fn() }));

vi.mock('../../../config/db', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

vi.mock('../../../config/metrics', () => ({
  dbQueryDuration: { startTimer: vi.fn(() => () => 0) },
}));

import { runGcsExportCycle, buildGcsPath } from '../gcs-exporter';
import type { ExportableSend } from '../gcs-parquet-builder';

function send(over: Partial<ExportableSend>): ExportableSend {
  return {
    audit_id: 1,
    site_id: 'S042',
    ts: '2026-06-24T12:00:00.000Z',
    sent_at: '2026-06-24T12:05:00.000Z',
    dga_status_code: '00',
    comprobante: 'C-1',
    dga_message: 'ok',
    planta: 'Aguas Andinas',
    centro_de_obra: 'OB-0601-1',
    nombre_sensor: 'Pozo 1',
    caudal_instantaneo: '10.00',
    flujo_acumulado: '5000',
    nivel_freatico: '7.00',
    ...over,
  };
}

const NOW = new Date('2026-06-24T13:00:00.000Z');

describe('buildGcsPath', () => {
  it('carpeta=planta, archivo=nombre_sensor + timestamp, byte-idéntico (spec CCU)', () => {
    const path = buildGcsPath('Aguas Andinas', 'Pozo Norte', NOW);
    expect(path).toBe('Aguas Andinas/fecha_carga=2026-06-24/Pozo Norte_20260624130000.parquet');
  });

  it('sanitiza tildes/ñ conservando mayúsculas y espacios', () => {
    const path = buildGcsPath('Río Ñuble', 'Pozo Sur', NOW);
    expect(path).toBe('Rio Nuble/fecha_carga=2026-06-24/Pozo Sur_20260624130000.parquet');
  });
});

describe('runGcsExportCycle', () => {
  it('agrupa por sitio, sube un Parquet por sitio y registra un log por audit', async () => {
    const uploads: Array<{ path: string; bytes: number }> = [];
    const logged: Array<{
      audit_id: number;
      gcs_generation: string | null;
      gcs_md5: string | null;
    }> = [];

    const stats = await runGcsExportCycle({
      now: () => NOW,
      listExportableSends: async () => [
        send({ audit_id: 1, site_id: 'S042', dga_status_code: '00' }),
        send({ audit_id: 2, site_id: 'S042', dga_status_code: '07', comprobante: null }),
        send({ audit_id: 3, site_id: 'S099', planta: 'CCU Quilín' }),
      ],
      uploadParquet: async (path, buf) => {
        uploads.push({ path, bytes: buf.length });
        return { generation: '17823145881', md5: 'uYyo3UwCpq6xLUeN4djTLA==' };
      },
      insertGcsExportLog: async (input) => {
        logged.push({
          audit_id: input.audit_id,
          gcs_generation: input.gcs_generation,
          gcs_md5: input.gcs_md5,
        });
      },
    });

    expect(uploads).toHaveLength(2); // S042 + S099
    expect(logged.map((l) => l.audit_id).sort()).toEqual([1, 2, 3]); // incluido el rechazado '07'
    // El acuse de GCS (generation + md5) se persiste en cada fila del ledger.
    expect(logged.every((l) => l.gcs_generation === '17823145881')).toBe(true);
    expect(logged.every((l) => l.gcs_md5 === 'uYyo3UwCpq6xLUeN4djTLA==')).toBe(true);
    expect(stats.sites).toBe(2);
    expect(stats.sends).toBe(3);
    expect(stats.logged).toBe(3);
    expect(stats.failedSites).toBe(0);
  });

  it('si falla la subida de un sitio, NO registra log de ese sitio y sigue con los demás', async () => {
    const logged: number[] = [];

    const stats = await runGcsExportCycle({
      now: () => NOW,
      listExportableSends: async () => [
        send({ audit_id: 1, site_id: 'S042', nombre_sensor: 'Pozo Sur' }),
        send({ audit_id: 2, site_id: 'S099', nombre_sensor: 'Pozo Norte' }),
      ],
      uploadParquet: async (path) => {
        if (path.includes('Pozo Sur')) throw new Error('GCS 503');
        return { generation: '1', md5: 'm' };
      },
      insertGcsExportLog: async (input) => {
        logged.push(input.audit_id);
      },
    });

    expect(logged).toEqual([2]); // solo el sitio que subió OK
    expect(stats.failedSites).toBe(1);
    expect(stats.logged).toBe(1);
  });

  it('ciclo vacío: no sube ni registra nada', async () => {
    const uploads: string[] = [];
    const stats = await runGcsExportCycle({
      now: () => NOW,
      listExportableSends: async () => [],
      uploadParquet: async (path) => {
        uploads.push(path);
        return { generation: '1', md5: 'm' };
      },
      insertGcsExportLog: async () => {},
    });
    expect(uploads).toHaveLength(0);
    expect(stats.sites).toBe(0);
    expect(stats.logged).toBe(0);
  });

  it('sin bucket configurado: omite el ciclo sin subir', async () => {
    const uploads: string[] = [];
    const stats = await runGcsExportCycle({
      now: () => NOW,
      bucket: '', // override: sin bucket
      listExportableSends: async () => [send({ audit_id: 1 })],
      uploadParquet: async (path) => {
        uploads.push(path);
        return { generation: '1', md5: 'm' };
      },
      insertGcsExportLog: async () => {},
    });
    expect(uploads).toHaveLength(0);
    expect(stats.skipped).toBe(true);
  });
});
