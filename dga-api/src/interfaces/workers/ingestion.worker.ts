// Worker de ingestión: cada tick busca sitios vencidos y genera sus reportes.
// El scheduler lo dispara según INGESTION_CRON (default: cada minuto).
import { pollDueSites } from '../../application/ingestion/pollDueSites.usecase';
import { logger } from '../../shared/logger';

// Guard contra solapamiento: si un tick aún corre, descarta el siguiente
// para no duplicar trabajo ni saturar la DB.
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
