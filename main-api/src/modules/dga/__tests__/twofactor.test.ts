/**
 * Tests del middleware requireDgaTwoFactor — semántica HTTP de los fallos.
 *
 * Regla crítica: código 2FA inválido/expirado/repetido debe ser 403
 * (ForbiddenError), NUNCA 401. El interceptor del frontend hace logout()
 * ante cualquier 401 fuera de /api/auth/ — un 401 aquí expulsa de la
 * sesión a un admin autenticado que solo tipeó un código consumido.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// twofactor.ts importa logger (→ appConfig, exige env) y notifier (email).
// Ninguno participa en la validación del código — mock para test unitario.
vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../notifier', () => ({ sendDgaUserEmail: vi.fn() }));

import { requireDgaTwoFactor } from '../twofactor';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../../shared/errors';

function runMiddleware(user: unknown, code: string | undefined): unknown {
  const req = {
    user,
    headers: code === undefined ? {} : { 'x-dga-2fa-code': code },
  } as unknown as Request;
  const res = {} as Response;
  let captured: unknown = 'next-sin-error';
  const next: NextFunction = (err?: unknown) => {
    captured = err;
  };
  requireDgaTwoFactor(req, res, next);
  return captured;
}

const admin = { id: 7, email: 'admin@test.cl', tipo: 'Admin' };

describe('requireDgaTwoFactor — clases de error por caso', () => {
  it('sin usuario autenticado → UnauthorizedError (401 legítimo)', () => {
    const err = runMiddleware(undefined, '123456');
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it('sin header de código → ValidationError con DGA_2FA_REQUIRED', () => {
    const err = runMiddleware(admin, undefined) as ValidationError & { code?: string };
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('DGA_2FA_REQUIRED');
  });

  it('código inválido/repetido/expirado → ForbiddenError (403), NUNCA 401', () => {
    // Sin código pendiente emitido para este user → verify falla, mismo path
    // que un código ya consumido (single-use) o vencido.
    const err = runMiddleware(admin, '000000') as ForbiddenError & { code?: string };
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
    expect(err.code).toBe('DGA_2FA_INVALID');
  });
});
