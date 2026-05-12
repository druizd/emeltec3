/**
 * Middleware de autenticación JWT (v2).
 * Verifica `Authorization: Bearer <token>`, deposita el payload en `req.user`.
 * Comparte JWT_SECRET con el legacy `src/middlewares/authMiddleware.js`.
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { ForbiddenError, UnauthorizedError } from '../shared/errors';
import type { AuthUser, UserTipo } from '../shared/permissions';

interface JwtPayload {
  id?: string | number;
  email?: string;
  tipo: UserTipo;
  empresa_id?: string | null;
  sub_empresa_id?: string | null;
}

export function protect(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  let token: string | undefined;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice('Bearer '.length).trim();
  }
  if (!token) {
    next(new UnauthorizedError('Acceso no autorizado. Token faltante.'));
    return;
  }
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
    (req as Request & { user?: AuthUser }).user = decoded as AuthUser;
    next();
  } catch {
    next(new UnauthorizedError('Token inválido o expirado'));
  }
}

export function authorizeRoles(...roles: UserTipo[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = (req as Request & { user?: AuthUser }).user;
    if (!user || !roles.includes(user.tipo)) {
      next(
        new ForbiddenError(
          `El rol ${user ? user.tipo : 'desconocido'} no tiene acceso a esta acción`,
        ),
      );
      return;
    }
    next();
  };
}
