/**
 * Middleware que registra duración HTTP en prom-client.
 * Usa `req.route?.path` para evitar cardinalidad alta por path params dinámicos.
 */
import type { Request, Response, NextFunction } from 'express';
import { httpRequestDuration } from '../config/metrics';

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer({ method: req.method });
  res.on('finish', () => {
    const route =
      // route.path se setea sólo cuando matched. Fallback a baseUrl + originalUrl para 404.
      (req.route?.path && (req.baseUrl ?? '') + req.route.path) ||
      req.baseUrl ||
      'unknown';
    end({ route, status_code: String(res.statusCode) });
  });
  next();
}
