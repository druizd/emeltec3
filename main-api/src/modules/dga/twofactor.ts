/**
 * 2FA email-OTP para acciones destructivas DGA (aceptar fallback, editar
 * valores, descartar slot). Mantiene el alcance simple: 6 dígitos, TTL 5min,
 * almacenamiento en memoria (suficiente para single-instance).
 *
 * El código se envía al email del usuario que lo solicita (no a un admin
 * global), de modo que quien va a ejecutar la acción es quien lo recibe.
 *
 * Multi-instance: migrar a Redis cuando el deploy lo requiera. Cambiar
 * `pendingCodes` Map por get/set con TTL en Redis.
 *
 * Patrón de uso:
 *   1. Usuario → POST /api/v2/dga/2fa/request → genera + envía email al solicitante.
 *   2. Usuario → POST /api/v2/dga/review-queue/* con header X-DGA-2FA-Code.
 *   3. requireDgaTwoFactor middleware valida y consume el código.
 *
 * Códigos son single-use para evitar reuso si el header se loguea.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  ForbiddenError,
  InternalError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors';
import type { AuthUser } from '../../shared/permissions';
import { logger } from '../../config/logger';
import { sendDgaUserEmail } from './notifier';

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
 * Genera un código nuevo (invalida el anterior si existía) y lo envía al
 * email del solicitante. NO devuelve el código al cliente — solo viaja
 * por email. Solo guarda el código en `pendingCodes` si el envío fue
 * exitoso (evita que el endpoint reporte 200 sin haber entregado nada).
 */
export async function requestDgaCode(user: AuthUser): Promise<void> {
  const userId = String(user.id ?? user.email ?? 'unknown');
  const to = user.email;
  if (!to) {
    throw new ValidationError('Usuario sin email; no se puede enviar código 2FA', {
      code: 'DGA_2FA_NO_EMAIL',
    });
  }
  const code = generateCode();
  try {
    await sendDgaUserEmail({
      to,
      subject: `[DGA] Código de verificación 2FA`,
      body:
        `Código: ${code}\n\n` +
        `Vence en 5 minutos. Single-use.\n` +
        `Solicitado por: ${to}\n\n` +
        `Si no fuiste vos, ignora este email y revisa accesos a la cuenta.`,
    });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, userId, to },
      'DGA 2FA: fallo al enviar email — código no emitido',
    );
    throw new InternalError('No se pudo enviar el código 2FA por email', {
      code: 'DGA_2FA_EMAIL_FAILED',
      cause: err,
    });
  }
  pendingCodes.set(userId, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    userId,
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
export function requireDgaTwoFactor(req: Request, _res: Response, next: NextFunction): void {
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
    // 403, NUNCA 401: el usuario ESTÁ autenticado (JWT válido), solo falló
    // el segundo factor. El interceptor del frontend hace logout() ante
    // cualquier 401 — un 401 aquí expulsaba de la sesión al admin que
    // reutilizaba un código single-use ya consumido.
    return next(new ForbiddenError('Código 2FA inválido o expirado', { code: 'DGA_2FA_INVALID' }));
  }
  next();
}
