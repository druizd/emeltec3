import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infrastructure/db/reports.repo', () => ({
  findPending: vi.fn(),
  updateSubmissionResult: vi.fn(),
}));

vi.mock('../application/submission/submitReportToDga.usecase', () => ({
  submitReportToDga: vi.fn(),
}));

vi.mock('../shared/env', () => ({
  config: { dga: { rutEmpresa: '77555666-7' } },
}));

vi.mock('../shared/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { submitPendingReports } from '../application/submission/submitPendingReports.usecase';
import { findPending, updateSubmissionResult } from '../infrastructure/db/reports.repo';
import { submitReportToDga } from '../application/submission/submitReportToDga.usecase';
import { logger } from '../shared/logger';
import type { PendingSubmission } from '../domain/submission/pendingSubmission.types';

const ts = new Date('2026-05-14T10:00:00Z');

const pendingItem: PendingSubmission = {
  idDgauser: 1,
  obra: 'OB-0101-114',
  rutInformante: '20999888-7',
  claveInformante: '9A4PUqd1t4',
  intentos: 0,
  report: {
    sitioId: 'S01',
    obra: 'OB-0101-114',
    timestamp: ts,
    nivelFreatico: 9.85,
    caudal: 1.0,
    totalizado: 1010,
  },
};

beforeEach(() => {
  vi.mocked(updateSubmissionResult).mockResolvedValue(undefined);
});

describe('submitPendingReports', () => {
  it('sin pendientes → solo loguea debug, no llama submitReportToDga', async () => {
    vi.mocked(findPending).mockResolvedValue([]);

    await submitPendingReports();

    expect(submitReportToDga).not.toHaveBeenCalled();
    expect(updateSubmissionResult).not.toHaveBeenCalled();
    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      expect.stringContaining('sin reportes pendientes'),
    );
  });

  it('envío exitoso → updateSubmissionResult con estatus enviado y comprobante', async () => {
    vi.mocked(findPending).mockResolvedValue([pendingItem]);
    vi.mocked(submitReportToDga).mockResolvedValue({
      url: 'https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas',
      estatus: 'enviado',
      comprobante: 'ABC123',
      raw: {},
    });

    await submitPendingReports();

    expect(updateSubmissionResult).toHaveBeenCalledWith({
      idDgauser: 1,
      ts,
      estatus: 'enviado',
      comprobante: 'ABC123',
    });
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.objectContaining({ comprobante: 'ABC123', sitioId: 'S01' }),
      expect.stringContaining('enviado OK'),
    );
  });

  it('DGA rechaza → updateSubmissionResult con estatus rechazado', async () => {
    vi.mocked(findPending).mockResolvedValue([pendingItem]);
    vi.mocked(submitReportToDga).mockResolvedValue({
      url: 'https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas',
      estatus: 'rechazado',
      raw: { status: '99', message: 'Error' },
    });

    await submitPendingReports();

    expect(updateSubmissionResult).toHaveBeenCalledWith(
      expect.objectContaining({ estatus: 'rechazado', idDgauser: 1, ts }),
    );
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ sitioId: 'S01' }),
      expect.stringContaining('rechazado'),
    );
  });

  it('error de red → marca rechazado y continúa con el siguiente item', async () => {
    const item2: PendingSubmission = {
      ...pendingItem,
      idDgauser: 2,
      report: { ...pendingItem.report, sitioId: 'S02' },
    };

    vi.mocked(findPending).mockResolvedValue([pendingItem, item2]);
    vi.mocked(submitReportToDga)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        url: '',
        estatus: 'enviado',
        comprobante: 'XYZ',
        raw: {},
      });

    await submitPendingReports();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({ sitioId: 'S01' }),
      expect.any(String),
    );
    // Segundo item sigue procesándose
    expect(updateSubmissionResult).toHaveBeenCalledWith(
      expect.objectContaining({ idDgauser: 2, estatus: 'enviado' }),
    );
  });

  it('error de red → updateSubmissionResult llamado con rechazado para ese item', async () => {
    vi.mocked(findPending).mockResolvedValue([pendingItem]);
    vi.mocked(submitReportToDga).mockRejectedValue(new Error('timeout'));

    await submitPendingReports();

    expect(updateSubmissionResult).toHaveBeenCalledWith(
      expect.objectContaining({ idDgauser: 1, estatus: 'rechazado' }),
    );
  });

  it('arma payload con rutEmpresa del config', async () => {
    vi.mocked(findPending).mockResolvedValue([pendingItem]);
    vi.mocked(submitReportToDga).mockResolvedValue({
      url: '',
      estatus: 'enviado',
      comprobante: 'C1',
      raw: {},
    });

    await submitPendingReports();

    const [calledPayload] = vi.mocked(submitReportToDga).mock.calls[0]!;
    expect(calledPayload.informante.rutEmpresa).toBe('77555666-7');
    expect(calledPayload.informante.rut).toBe('20999888-7');
    expect(calledPayload.informante.clave).toBe('9A4PUqd1t4');
  });

  it('procesa múltiples items en un tick', async () => {
    const items = [1, 2, 3].map((n) => ({
      ...pendingItem,
      idDgauser: n,
      report: { ...pendingItem.report, sitioId: `S0${n}` },
    }));

    vi.mocked(findPending).mockResolvedValue(items);
    vi.mocked(submitReportToDga).mockResolvedValue({
      url: '',
      estatus: 'enviado',
      comprobante: 'CX',
      raw: {},
    });

    await submitPendingReports();

    expect(submitReportToDga).toHaveBeenCalledTimes(3);
    expect(updateSubmissionResult).toHaveBeenCalledTimes(3);
  });
});
