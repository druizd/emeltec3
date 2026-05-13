import { config } from './shared/env';
import { logger } from './shared/logger';
import { closePool, pingDb } from './infrastructure/db/pool';
import { buildApp } from './interfaces/http/server';
import { startScheduler, stopScheduler } from './interfaces/workers/scheduler';

async function bootstrap(): Promise<void> {
  const dbOk = await pingDb();
  if (!dbOk) {
    logger.error('[bootstrap] DB no responde al arranque');
  }

  const app = buildApp();
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      `[dga-api] HTTP corriendo en http://localhost:${config.port}`,
    );
    startScheduler();
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, '[dga-api] cerrando servicios');
    stopScheduler();
    server.close(() => {
      logger.info('[dga-api] HTTP detenido');
      void closePool().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error({ err }, '[bootstrap] fallo al iniciar');
  process.exit(1);
});
