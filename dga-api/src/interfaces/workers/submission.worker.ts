// Worker de sumisión (stub): tomará reportes pendientes y los enviará a MIA-DGA.
// Cron separado del de ingestión para desacoplar generación local del envío externo.
// Hoy es un no-op; se completará cuando esté definida la integración con DGA.
import { logger } from '../../shared/logger';

export async function runSubmissionTick(): Promise<void> {
  logger.debug('[submission] tick — pendiente de implementar (cron 2)');
}
