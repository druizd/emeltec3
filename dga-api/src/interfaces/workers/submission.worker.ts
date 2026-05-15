import { submitPendingReports } from '../../application/submission/submitPendingReports.usecase';
import { logger } from '../../shared/logger';

let running = false;

export async function runSubmissionTick(): Promise<void> {
  if (running) {
    logger.warn('[submission] tick anterior aún en ejecución, se omite este');
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    await submitPendingReports();
    logger.debug({ ms: Date.now() - startedAt }, '[submission] tick completado');
  } catch (err) {
    logger.error({ err }, '[submission] tick falló');
  } finally {
    running = false;
  }
}
