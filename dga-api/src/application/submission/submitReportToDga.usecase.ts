import type { DgaSubmissionPayload, DgaSubmissionResponse } from '../../domain/submission/dgaEnvelope';
import { submitToDga } from '../../infrastructure/dga-client/dgaApi.client';

export async function submitReportToDga(payload: DgaSubmissionPayload): Promise<DgaSubmissionResponse> {
  return submitToDga(payload);
}
