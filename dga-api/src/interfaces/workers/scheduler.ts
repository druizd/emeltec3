// Scheduler central: arranca/detiene los crons de los workers.
//  - Ingestion: cadencia configurable vía INGESTION_CRON (default '* * * * *' = cada minuto).
//  - Submission: cada 5 minutos (cuando ENABLE_SUBMISSION_WORKER esté activo).
// Las flags ENABLE_*_WORKER permiten levantar solo HTTP en algunos despliegues.
import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../../shared/env';
import { logger } from '../../shared/logger';
import { runIngestionTick } from './ingestion.worker';
import { runSubmissionTick } from './submission.worker';

// Referencias a las tareas activas para poder detenerlas en shutdown.
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
    const submission = cron.schedule(config.workers.submissionCron, () => {
      void runSubmissionTick();
    });
    tasks.push(submission);
    logger.info({ cron: config.workers.submissionCron }, '[scheduler] submission worker iniciado');
  }
}

// Detiene todos los crons. Lo invoca el shutdown handler en main.ts.
export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
