// Contratos para el envío hacia la API oficial MIA-DGA (Monitoreo de Información Ambiental).
// Aún no se conoce la spec final del payload → `buildDgaPayload` queda como stub.
import type { DgaReport } from '../reports/report.types';

// Credenciales del informante autorizado ante DGA (RUT + clave entregados por la autoridad).
export interface DgaInformante {
  rut: string;
  clave: string;
}

// Payload completo para una sumisión: credenciales + obra (código DGA) + reporte.
export interface DgaSubmissionPayload {
  informante: DgaInformante;
  obraDga: string;
  report: DgaReport;
}

// Respuesta normalizada de DGA: URL del trámite, estatus y comprobante.
export interface DgaSubmissionResponse {
  url: string;
  estatus: 'enviado' | 'pendiente' | 'rechazado';
  comprobante?: string;
  raw: unknown;  // Respuesta cruda para auditoría/debug.
}

// Stub: pendiente de definir el formato exacto del payload según la spec MIA-DGA.
export function buildDgaPayload(_args: DgaSubmissionPayload): Record<string, unknown> {
  throw new Error('NOT_IMPLEMENTED: buildDgaPayload — definir spec MIA-DGA');
}
