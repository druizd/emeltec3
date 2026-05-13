import { pollDueSites } from '../../application/ingestion/pollDueSites.usecase';
import { logger } from '../../shared/logger';

let running = false;

export async function runIngestionTick(): Promise<void> {
  if (running) {
    logger.warn('[ingestion] tick anterior aún en ejecución, se omite este');
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    await pollDueSites(new Date());
    logger.debug({ ms: Date.now() - startedAt }, '[ingestion] tick completado');
  } catch (err) {
    logger.error({ err }, '[ingestion] tick falló');
  } finally {
    running = false;
  }
}
