/**
 * Middleware de autenticación JWT (v2).
 * Verifica `Authorization: Bearer <token>`, deposita el payload en `req.user`.
 * Comparte JWT_SECRET con el legacy `src/middlewares/authMiddleware.js`.
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/appConfig';
import { isSessionRevoked } from '../services/sessionRevocation';
import {
  READ_ONLY_ERROR,
  actAsContext,
  isActAsToken,
  isReadOnlyMethod,
  isValidActAsToken,
  revocationSubject,
} from '../services/actAs';
import { ForbiddenError, UnauthorizedError } from '../shared/errors';
import type { AuthUser, UserTipo } from '../shared/permissions';

interface JwtPayload {
  id?: string | number;
  email?: string;
  tipo: UserTipo;
  empresa_id?: string | null;
  sub_empresa_id?: string | null;
  iat?: number;
  /** Token "ver como" de SuperAdmin (solo lectura). Ver services/actAs.js. */
  act_as?: boolean;
  real_sub?: string;
}

type ReqWithUser = Request & { user?: AuthUser; actAs?: { realUserId: string } };

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
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, config.auth.jwtSecret, {
      algorithms: ['HS256'],
    }) as JwtPayload;
  } catch {
    next(new UnauthorizedError('Token inválido o expirado'));
    return;
  }

  // Token "ver como" (SuperAdmin simulando un rol): solo lectura.
  const actAs = isActAsToken(decoded);
  if (actAs) {
    if (!isValidActAsToken(decoded)) {
      next(new UnauthorizedError('Token inválido o expirado'));
      return;
    }
    if (!isReadOnlyMethod(req.method)) {
      // Se deposita la identidad ANTES de rechazar: `auditMutations` (montado
      // antes del router) lee req.user / req.actAs al terminar la respuesta.
      (req as ReqWithUser).user = decoded as AuthUser;
      (req as ReqWithUser).actAs = actAsContext(decoded);
      next(new ForbiddenError(READ_ONLY_ERROR));
      return;
    }
  }

  const attach = (): void => {
    (req as ReqWithUser).user = decoded as AuthUser;
    if (actAs) (req as ReqWithUser).actAs = actAsContext(decoded);
    next();
  };

  // Un cambio de contraseña corta las sesiones previas (sessions_valid_from).
  // Con "ver como" se evalúa contra el SuperAdmin real, no contra el id simulado.
  // Si la DB falla, "ver como" falla cerrado (401); los tokens normales fallan abiertos.
  isSessionRevoked(revocationSubject(decoded), { failClosed: actAs })
    .then((revoked) => {
      if (revoked) {
        next(new UnauthorizedError('Sesión cerrada por un cambio de contraseña. Vuelve a entrar.'));
        return;
      }
      attach();
    })
    .catch(() => {
      if (actAs) {
        next(new UnauthorizedError('No se pudo validar la sesión. Vuelve a entrar.'));
        return;
      }
      attach();
    });
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
