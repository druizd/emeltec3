/**
 * Controllers HTTP v2 de companies.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { UnauthorizedError } from '../../shared/errors';
import type { AuthUser } from '../../shared/permissions';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { getHierarchyTreeForUser } from './service';

export async function getHierarchyTreeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const user = (req as Request & { user?: AuthUser }).user;
  if (!user) return next(new UnauthorizedError());
  try {
    const tree = await getHierarchyTreeForUser(user);
    res.json(ok(tree, { count: tree.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}
