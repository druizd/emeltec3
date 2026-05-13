import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from '../../shared/env';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { requestIdMiddleware } from './middlewares/requestId';
import { apiRouter } from './routes';

export function buildApp(): Express {
  const app = express();

  app.use(helmet());

  const origins = config.corsOrigin.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || origins.includes('*') || origins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error(`Origen no permitido por CORS: ${origin}`));
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);

  app.use(
    '/api/dga/',
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes' } },
    }),
  );

  app.use('/api/dga', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
