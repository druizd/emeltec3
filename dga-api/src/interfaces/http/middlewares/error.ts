// Manejadores globales de errores HTTP.
//  - `notFoundHandler`: cualquier ruta no matcheada → 404 con envelope estándar.
//  - `errorHandler`: convierte AppError en respuesta tipada (status/code/message)
//    y todo lo demás en 500 con `INTERNAL_ERROR`. Loggea 5xx como `error`, 4xx como `warn`.
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../../shared/errors';
import { err as envErr } from '../../../shared/envelope';
import { logger } from '../../../shared/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(envErr('NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.path}`, req.requestId));
}

// Express identifica este middleware como "error handler" por su firma de 4 args.
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ err: error, requestId: req.requestId }, '[http] error servidor');
    } else {
      logger.warn({ err: error, requestId: req.requestId }, '[http] error cliente');
    }
    res.status(error.status).json(envErr(error.code, error.message, req.requestId, error.details));
    return;
  }

  const message = error instanceof Error ? error.message : 'Error desconocido';
  logger.error({ err: error, requestId: req.requestId }, '[http] excepción no controlada');
  res.status(500).json(envErr('INTERNAL_ERROR', message, req.requestId));
}
