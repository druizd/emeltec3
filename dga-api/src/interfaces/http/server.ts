// Construcción de la app Express con su pila de middlewares.
// Orden importa: helmet → cors → json → requestId → rateLimit → router → notFound → errorHandler.
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

  // Headers de seguridad por defecto (CSP, X-Frame-Options, HSTS, etc.).
  app.use(helmet());

  // CORS: lista blanca desde CORS_ORIGIN (separada por comas) o '*' para permitir todo.
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

  // Parser de JSON con tope de 1MB para limitar abuso.
  app.use(express.json({ limit: '1mb' }));
  // Asigna x-request-id a cada request (ver requestId.ts).
  app.use(requestIdMiddleware);

  // Rate limit aplicado solo a la API DGA (no a /health). 200 req / 15 min por defecto.
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

  // Montaje de rutas bajo /api/dga.
  app.use('/api/dga', apiRouter);

  // 404 + manejador global de errores (deben ir al final).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
