import { selectDueSites } from '../../domain/periodicity/periodicity.rules';
import * as periodicityRepo from '../../infrastructure/db/periodicity.repo';
import { logger } from '../../shared/logger';
import { generateReport } from './generateReport.usecase';

export async function pollDueSites(now: Date = new Date()): Promise<void> {
  let periodicities;
  try {
    periodicities = await periodicityRepo.listAll();
  } catch (err) {
    logger.error({ err }, '[ingestion] no se pudo leer tabla de periodicidad');
    return;
  }

  const due = selectDueSites(periodicities, now);
  if (due.length === 0) {
    logger.debug('[ingestion] sin sitios que reportar en este tick');
    return;
  }

  logger.info({ count: due.length }, '[ingestion] sitios a procesar');

  for (const candidate of due) {
    try {
      await generateReport(candidate.sitioId, candidate.dueAt);
      await periodicityRepo.markReported(candidate.sitioId, candidate.dueAt);
    } catch (err) {
      logger.error({ err, sitioId: candidate.sitioId }, '[ingestion] falló reporte');
    }
  }
}
