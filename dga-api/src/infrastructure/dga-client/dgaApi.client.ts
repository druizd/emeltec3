import { buildDgaPayload } from '../../domain/submission/dgaEnvelope';
import type { DgaSubmissionPayload, DgaSubmissionResponse } from '../../domain/submission/dgaEnvelope';
import { ExternalServiceError } from '../../shared/errors';
import { config } from '../../shared/env';
import { logger } from '../../shared/logger';

export async function submitToDga(payload: DgaSubmissionPayload): Promise<DgaSubmissionResponse> {
  const { headers, body } = buildDgaPayload(payload);

  const url = config.dga.apiUrl;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const raw: unknown = await response.json().catch(() => null);

  logger.debug(
    { status: response.status, sitioId: payload.report.sitioId },
    '[dga-client] respuesta MIA-DGA',
  );

  if (!response.ok) {
    throw new ExternalServiceError(
      'MIA-DGA',
      `HTTP ${response.status} para sitio ${payload.report.sitioId}`,
      raw,
    );
  }

  const comprobante =
    typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : undefined;

  return {
    url,
    estatus: 'enviado',
    ...(comprobante !== undefined && { comprobante }),
    raw,
  };
}
