/**
 * Entry point del proceso. Levanta HTTP + workers.
 */
import app from './app';
import { config } from './config/env';
import { logger } from './config/logger';
import { startMetricsFlusher, stopMetricsFlusher } from './modules/metrics/flusher';
import { startAlertsWorker, stopAlertsWorker } from './modules/alerts/worker';

const httpServer = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'main-api HTTP iniciado');
  startAlertsWorker();
  void startMetricsFlusher();
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Cerrando servicios');
  stopAlertsWorker();
  void stopMetricsFlusher();
  httpServer.close(() => logger.info('HTTP detenido'));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'uncaughtException');
  process.exit(1);
});
