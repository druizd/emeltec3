/**
 * Configuración central de Express. Único router activo: /api/v2.
 * Toda la lógica vive en `src/modules/<bounded-context>/*`.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config/env';
import { logger } from './config/logger';
import { requestIdMiddleware } from './middlewares/requestId';
import { errorMiddleware } from './middlewares/error';
import v2Router from './http/v2/routes';
import { NotFoundError } from './shared/errors';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(requestIdMiddleware);
app.use(helmet());

const allowedOrigins = config.corsOrigin.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
  }),
);

const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas solicitudes.' } },
});
app.use('/api/', globalLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(
  morgan(config.isProd ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }),
);

app.use('/api/v2', v2Router);

// 404 explícito para rutas no montadas.
app.use((req: Request, _res: Response, next: NextFunction) => {
  next(new NotFoundError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
});

app.use(errorMiddleware);

export default app;
