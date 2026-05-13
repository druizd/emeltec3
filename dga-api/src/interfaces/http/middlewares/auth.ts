// Middlewares de autenticación:
//  - `authProtect`: valida un JWT en `Authorization: Bearer ...` (usado por endpoints de usuario).
//  - `requireInternalKey`: valida una API key fija en `x-internal-api-key` (usado por jobs/herramientas internas).
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../../shared/env';
import { UnauthorizedError } from '../../../shared/errors';

// Claims esperados dentro del JWT (no todos obligatorios; mínimo `sub`).
export interface AuthPayload {
  sub: string;
  email?: string;
  empresaId?: string;
  subEmpresaId?: string;
  tipo?: string;
  rol?: string;
}

// Expone `req.auth` con los claims decodificados para handlers downstream.
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
  }
}

// Verifica firma + expiración del JWT con `JWT_SECRET`. Falla con 401 si no.
export function authProtect(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Token requerido'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret) as AuthPayload;
    req.auth = decoded;
    next();
  } catch (err) {
    next(new UnauthorizedError('Token inválido o expirado'));
    void err;
  }
}

// Compara estrictamente la API key recibida contra `INTERNAL_API_KEY`.
// Si la env var no está definida, el endpoint queda cerrado por defecto (fail-closed).
export function requireInternalKey(req: Request, _res: Response, next: NextFunction): void {
  const expected = config.auth.internalApiKey;
  if (!expected) return next(new UnauthorizedError('INTERNAL_API_KEY no configurado'));
  const provided = req.header('x-internal-api-key');
  if (provided !== expected) return next(new UnauthorizedError('API key inválida'));
  next();
}
