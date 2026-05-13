import type { DgaReport } from '../reports/report.types';

export interface DgaInformante {
  rut: string;
  clave: string;
}

export interface DgaSubmissionPayload {
  informante: DgaInformante;
  obraDga: string;
  report: DgaReport;
}

export interface DgaSubmissionResponse {
  url: string;
  estatus: 'enviado' | 'pendiente' | 'rechazado';
  comprobante?: string;
  raw: unknown;
}

export function buildDgaPayload(_args: DgaSubmissionPayload): Record<string, unknown> {
  throw new Error('NOT_IMPLEMENTED: buildDgaPayload — definir spec MIA-DGA');
}
