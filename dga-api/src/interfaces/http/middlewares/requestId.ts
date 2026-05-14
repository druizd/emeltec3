// Middleware que asigna o propaga un `x-request-id` por request.
// Si el cliente lo envía y es razonable (≤128 chars), se respeta; si no, se genera un UUID.
// El id viaja en `req.requestId`, en la respuesta y en los logs → permite correlacionar trazas.
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

// Extiende el tipo Request de Express para incluir el campo opcional `requestId`.
declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
