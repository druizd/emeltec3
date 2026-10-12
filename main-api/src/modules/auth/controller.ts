/**
 * Controllers HTTP v2 de auth.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../shared/errors';
import type { AuthUser } from '../../shared/permissions';
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
  if (!parsed.success)
    return next(new ValidationError('Body inválido', { details: parsed.error.flatten() }));
  try {
    const result = await svc.login(parsed.data.email, parsed.data.password);
    res.json(ok(result));
  } catch (err) {
    next(err);
  }
}

const viewAsSchema = z.object({
  role: z.enum(['Admin', 'Gerente', 'Cliente', 'Vendedor']),
  empresa_id: z.string().min(1).nullish(),
  sub_empresa_id: z.string().min(1).nullish(),
});

// auditLog es CJS legacy: bitácora append-only (Ley 21.663 §32).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { record: recordAudit } = require('../../services/auditLog') as {
  record: (entry: Record<string, unknown>) => Promise<void>;
};

type ViewAsRequest = Request & {
  user?: AuthUser;
  actAs?: { realUserId: string };
};

/**
 * POST /api/v2/auth/view-as — SuperAdmin pide un token de solo lectura que ve
 * lo que vería el rol/alcance elegido. Ver `issueViewAsToken`.
 */
export async function viewAsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { user, actAs } = req as ViewAsRequest;
  if (!user) return next(new UnauthorizedError('No autenticado'));
  // Antes de validar el body: un no-SuperAdmin no debe aprender nada del esquema.
  if (user.tipo !== 'SuperAdmin' || actAs) {
    return next(new ForbiddenError('Solo un SuperAdmin puede usar "ver como".'));
  }
  const parsed = viewAsSchema.safeParse(req.body);
  if (!parsed.success)
    return next(new ValidationError('Body inválido', { details: parsed.error.flatten() }));
  try {
    const result = await svc.issueViewAsToken(user, Boolean(actAs), parsed.data);
    // Una suplantación emitida queda en la bitácora: actor = SuperAdmin real.
    await recordAudit({
      req,
      action: 'auth.view_as.issue',
      actorId: user.id ?? null,
      actorEmail: user.email ?? null,
      actorTipo: user.tipo,
      targetType: 'view_as',
      targetId: result.view_as.sub_empresa_id ?? result.view_as.empresa_id,
      statusCode: 200,
      metadata: {
        outcome: 'ok',
        view_as_tipo: result.view_as.tipo,
        empresa_id: result.view_as.empresa_id,
        sub_empresa_id: result.view_as.sub_empresa_id,
        expires_in: result.expires_in,
      },
    });
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
  if (!parsed.success)
    return next(new ValidationError('Body inválido', { details: parsed.error.flatten() }));
  try {
    const result = await svc.requestCode(parsed.data.email, parsed.data.expires_minutes);
    res.json(ok(result));
  } catch (err) {
    next(err);
  }
}
