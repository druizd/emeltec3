import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../../shared/env';
import { logger } from '../../shared/logger';
import { runIngestionTick } from './ingestion.worker';
import { runSubmissionTick } from './submission.worker';

const tasks: ScheduledTask[] = [];

export function startScheduler(): void {
  if (config.workers.ingestionEnabled) {
    const ingestion = cron.schedule(config.workers.ingestionCron, () => {
      void runIngestionTick();
    });
    tasks.push(ingestion);
    logger.info({ cron: config.workers.ingestionCron }, '[scheduler] ingestion worker iniciado');
  } else {
    logger.warn('[scheduler] ingestion worker deshabilitado (ENABLE_INGESTION_WORKER=false)');
  }

  if (config.workers.submissionEnabled) {
    const submission = cron.schedule('*/5 * * * *', () => {
      void runSubmissionTick();
    });
    tasks.push(submission);
    logger.info('[scheduler] submission worker iniciado');
  }
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
