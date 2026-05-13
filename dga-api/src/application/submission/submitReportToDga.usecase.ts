// Caso de uso: enviar un reporte ya generado hacia la API oficial MIA-DGA.
// Hoy es un wrapper del cliente; en el futuro irá envuelta lógica de reintentos, idempotencia y registro de comprobante.
import type { DgaSubmissionPayload, DgaSubmissionResponse } from '../../domain/submission/dgaEnvelope';
import { submitToDga } from '../../infrastructure/dga-client/dgaApi.client';

export async function submitReportToDga(payload: DgaSubmissionPayload): Promise<DgaSubmissionResponse> {
  return submitToDga(payload);
}
