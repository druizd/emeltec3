/**
 * 2FA email-OTP para acciones destructivas DGA (aceptar fallback, editar
 * valores, descartar slot). Mantiene el alcance simple: 6 dígitos, TTL 5min,
 * almacenamiento en memoria (suficiente para single-instance).
 *
 * Multi-instance: migrar a Redis cuando el deploy lo requiera. Cambiar
 * `pendingCodes` Map por get/set con TTL en Redis.
 *
 * Patrón de uso:
 *   1. Admin → POST /api/v2/dga/2fa/request → genera + envía email.
 *   2. Admin → POST /api/v2/dga/review-queue/* con header X-DGA-2FA-Code.
 *   3. requireDgaTwoFactor middleware valida y consume el código.
 *
 * Códigos son single-use para evitar reuso si el header se loguea.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ValidationError } from '../../shared/errors';
import type { AuthUser } from '../../shared/permissions';
import { logger } from '../../config/logger';
import { sendDgaAdminAlert } from './notifier';

const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_LENGTH = 6;

interface PendingCode {
  code: string;
  expiresAt: number;
  userId: string;
}

/** Key = `${userId}`. Solo un código activo por usuario a la vez. */
const pendingCodes = new Map<string, PendingCode>();

function generateCode(): string {
  // 6 dígitos uniformes. crypto.randomInt evita modulo bias.
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * Genera un código nuevo (invalida el anterior si existía), lo guarda con
 * TTL y lo envía al admin email configurado. NO devuelve el código al
 * cliente — solo viaja por email.
 */
export async function requestDgaCode(user: AuthUser): Promise<void> {
  const userId = String(user.id ?? user.email ?? 'unknown');
  const code = generateCode();
  pendingCodes.set(userId, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    userId,
  });
  await sendDgaAdminAlert({
    subject: `[DGA] Código de verificación 2FA`,
    body:
      `Código: ${code}\n\n` +
      `Vence en 5 minutos. Single-use.\n` +
      `Solicitado por: ${user.email ?? userId}\n\n` +
      `Si no fuiste vos, ignora este email y revisa accesos a la cuenta.`,
  });
  logger.info({ userId, ttl: CODE_TTL_MS }, 'DGA 2FA: código emitido y enviado por email');
}

/**
 * Verifica el código. Si OK: lo consume (single-use) y devuelve true.
 * Si falla: NO consume; admin puede reintentar hasta vencimiento.
 *
 * Comparación con timingSafeEqual para evitar timing attacks.
 */
export function verifyDgaCode(user: AuthUser, providedCode: string): boolean {
  const userId = String(user.id ?? user.email ?? 'unknown');
  const pending = pendingCodes.get(userId);
  if (!pending) return false;
  if (Date.now() > pending.expiresAt) {
    pendingCodes.delete(userId);
    return false;
  }
  const expectedBuf = Buffer.from(pending.code, 'utf8');
  const providedBuf = Buffer.from(String(providedCode || '').slice(0, CODE_LENGTH), 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) return false;
  // Consumir: single-use.
  pendingCodes.delete(userId);
  return true;
}

/**
 * Middleware Express: exige header `X-DGA-2FA-Code` válido. El handler
 * de la acción se ejecuta solo si pasa.
 */
export function requireDgaTwoFactor(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const user = (req as Request & { user?: AuthUser }).user;
  if (!user) {
    return next(new UnauthorizedError('No autenticado'));
  }
  const code = String(req.headers['x-dga-2fa-code'] ?? '').trim();
  if (!code) {
    return next(
      new ValidationError('2FA requerido — solicita un código y reenvía con X-DGA-2FA-Code', {
        code: 'DGA_2FA_REQUIRED',
      }),
    );
  }
  if (!verifyDgaCode(user, code)) {
    return next(
      new UnauthorizedError('Código 2FA inválido o expirado', { code: 'DGA_2FA_INVALID' }),
    );
  }
  next();
}
