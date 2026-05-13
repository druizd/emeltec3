// Cliente HTTP hacia la API oficial MIA-DGA (stub).
// Implementará: autenticación con RUT/clave del informante, POST del payload, parseo de la respuesta
// (comprobante, URL del trámite, estatus enviado/pendiente/rechazado).
import type { DgaSubmissionPayload, DgaSubmissionResponse } from '../../domain/submission/dgaEnvelope';

export async function submitToDga(_payload: DgaSubmissionPayload): Promise<DgaSubmissionResponse> {
  throw new Error('NOT_IMPLEMENTED: submitToDga — pendiente definición endpoint MIA-DGA');
}
