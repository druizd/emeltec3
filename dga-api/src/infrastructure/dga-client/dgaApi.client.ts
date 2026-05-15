import { buildDgaPayload } from '../../domain/submission/dgaEnvelope';
import type {
  DgaSubmissionPayload,
  DgaSubmissionResponse,
} from '../../domain/submission/dgaEnvelope';
import { ExternalServiceError } from '../../shared/errors';
import { config } from '../../shared/env';
import { logger } from '../../shared/logger';

interface MiaDgaResponseBody {
  status: string;
  message?: string;
  data?: { numeroComprobante?: string };
}

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
    { httpStatus: response.status, sitioId: payload.report.sitioId, raw },
    '[dga-client] respuesta MIA-DGA',
  );

  if (!response.ok) {
    throw new ExternalServiceError(
      'MIA-DGA',
      `HTTP ${response.status} para sitio ${payload.report.sitioId}`,
      raw,
    );
  }

  const parsed = raw as MiaDgaResponseBody | null;
  const dgaStatus = parsed?.status ?? '';
  const comprobante = parsed?.data?.numeroComprobante;

  // status '00' = ingresada correctamente según spec DGA enero 2025
  const estatus: DgaSubmissionResponse['estatus'] = dgaStatus === '00' ? 'enviado' : 'rechazado';

  if (estatus === 'rechazado') {
    logger.warn(
      { dgaStatus, message: parsed?.message, sitioId: payload.report.sitioId },
      '[dga-client] MIA-DGA rechazó la medición',
    );
  }

  return {
    url,
    estatus,
    ...(comprobante !== undefined && { comprobante }),
    raw,
  };
}
