/**
 * Controllers HTTP v2 de auth.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import * as svc from './service';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const requestCodeSchema = z.object({
  email: z.string().email(),
  expires_minutes: z.coerce.number().int().positive().max(1440).optional(),
});

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return next(new ValidationError('Body inválido', { details: parsed.error.flatten() }));
  try {
    const result = await svc.login(parsed.data.email, parsed.data.password);
    res.json(ok(result));
  } catch (err) {
    next(err);
  }
}

export async function requestCodeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = requestCodeSchema.safeParse(req.body);
  if (!parsed.success) return next(new ValidationError('Body inválido', { details: parsed.error.flatten() }));
  try {
    const result = await svc.requestCode(parsed.data.email, parsed.data.expires_minutes);
    res.json(ok(result));
  } catch (err) {
    next(err);
  }
}
