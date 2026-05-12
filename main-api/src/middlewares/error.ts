/**
 * Middleware global de errores (v2).
 * Convierte cualquier excepción en `ErrorEnvelope` consistente.
 * Mantiene compat con respuestas legacy: campos `ok:false, message, error`.
 */
import type { Request, Response, NextFunction } from 'express';
import { isAppError } from '../shared/errors';
import { err as buildErr } from '../shared/httpEnvelope';
import { logger } from '../config/logger';
import { config } from '../config/env';
import { getRequestId } from '../shared/requestContext';

export function errorMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = getRequestId();
  const isApp = isAppError(error);
  const status = isApp ? error.status : 500;
  const code = isApp ? error.code : 'INTERNAL_ERROR';
  const message =
    isApp && error.expose
      ? error.message
      : status === 500 && config.isProd
        ? 'Error interno del servidor'
        : (error as Error)?.message || 'Error interno del servidor';

  const logPayload = {
    method: req.method,
    url: req.originalUrl,
    status,
    code,
    err: error instanceof Error ? { message: error.message, stack: error.stack } : { error },
  };

  if (status >= 500) {
    logger.error(logPayload, 'Request falló');
  } else {
    logger.warn(logPayload, 'Request rechazado');
  }

  const errOpts: { details?: unknown; requestId?: string } = {};
  if (isApp && error.expose && error.details !== undefined) errOpts.details = error.details;
  if (requestId !== undefined) errOpts.requestId = requestId;
  const envelope = buildErr(code, message, errOpts);

  // Compat legacy: añadir `message` en raíz para clientes antiguos.
  res.status(status).json({ ...envelope, message });
}
