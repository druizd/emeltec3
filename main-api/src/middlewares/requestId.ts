/**
 * Middleware: genera o reusa x-request-id y arranca el AsyncLocalStorage de contexto.
 * Todo log posterior dentro del mismo request lleva el requestId automáticamente.
 */
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithContext, type RequestContext } from '../shared/requestContext';

const HEADER = 'x-request-id';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER);
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader(HEADER, requestId);

  const ctx: RequestContext = {
    requestId,
    startedAt: process.hrtime.bigint(),
  };

  runWithContext(ctx, () => next());
}
