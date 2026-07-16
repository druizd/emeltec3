/**
 * Email-OTP compartido para step-up 2FA (re-autenticación) en acciones
 * sensibles: user CRUD, alarmas, cold rooms y mutaciones DGA.
 *
 * Unifica los dos sistemas previos (shared/stepUp2fa.js y
 * modules/dga/twofactor.ts): un solo header `X-2FA-Code`, un solo endpoint
 * POST /api/2fa/request, códigos de error TWOFA_REQUIRED / TWOFA_INVALID.
 *
 * Flujo:
 *   1. Cliente → POST /api/2fa/request → código 6 dígitos al email del usuario
 *      (single-use, TTL 5 min).
 *   2. Cliente reintenta la acción con header `X-2FA-Code: <código>`.
 *   3. require2fa valida y consume el código.
 *
 * Anti fuerza bruta: máx MAX_ATTEMPTS intentos fallidos por código — al
 * alcanzarlos el código se invalida aunque el siguiente intento sea correcto
 * (debilidad compartida de las dos implementaciones anteriores: reintentos
 * ilimitados dentro del TTL contra un espacio de 10^6).
 *
 * Almacenamiento en memoria (single-instance). Multi-instance: migrar
 * `pending` a Redis con TTL — ahora en UN solo lugar.
 */
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
// emailService es CommonJS (allowJs) — send2faCode manda el correo branded
// "Código de verificación · Emeltec".
import { send2faCode } from '../services/emailService';

export const CODE_TTL_MS = 5 * 60 * 1000;
export const CODE_LEN = 6;
export const MAX_ATTEMPTS = 5;

interface PendingCode {
  code: string;
  expiresAt: number;
  failedAttempts: number;
}

interface OtpUser {
  id?: string | number;
  email?: string;
}

/** userId → código pendiente. Un código activo por usuario. */
const pending = new Map<string, PendingCode>();

function userKey(user: OtpUser | null | undefined): string {
  return String(user?.id ?? user?.email ?? '');
}

function genCode(): string {
  // 6 dígitos uniformes (crypto.randomInt evita modulo bias).
  return String(crypto.randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0');
}

class OtpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Genera un código nuevo (invalida el anterior si existía) y lo envía por
 * email. Solo lo guarda si el email salió OK — no reportar 200 sin haber
 * entregado nada.
 */
export async function requestCode(user: OtpUser): Promise<void> {
  const key = userKey(user);
  const to = user?.email;
  if (!key || !to) {
    throw new OtpError('Usuario sin email; no se puede enviar código 2FA', 400);
  }
  const code = genCode();
  const sent = await send2faCode({ to, code, minutes: Math.round(CODE_TTL_MS / 60000) });
  if (!sent || !sent.ok) {
    throw new OtpError('No se pudo enviar el código 2FA por email', 502);
  }
  pending.set(key, { code, expiresAt: Date.now() + CODE_TTL_MS, failedAttempts: 0 });
}

/**
 * Verifica y consume (single-use) el código. timingSafeEqual contra timing
 * attacks. Cada fallo cuenta: al MAX_ATTEMPTS-ésimo se invalida el código.
 */
export function verifyCode(user: OtpUser, providedCode: string): boolean {
  const key = userKey(user);
  const p = pending.get(key);
  if (!p) return false;
  if (Date.now() > p.expiresAt) {
    pending.delete(key);
    return false;
  }

  const expected = Buffer.from(p.code, 'utf8');
  const provided = Buffer.from(String(providedCode || '').slice(0, CODE_LEN), 'utf8');
  const matches = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!matches) {
    p.failedAttempts += 1;
    if (p.failedAttempts >= MAX_ATTEMPTS) pending.delete(key);
    return false;
  }

  pending.delete(key); // single-use
  return true;
}

/**
 * Middleware Express: exige header `X-2FA-Code` válido.
 *
 * 403, NUNCA 401 cuando falta/falla el código: el usuario está autenticado
 * (JWT válido), solo falta el step-up. El authInterceptor del frontend hace
 * logout() ante cualquier 401.
 */
export function require2fa(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user?: OtpUser }).user;
  if (!user) {
    res.status(401).json({ ok: false, error: 'No autenticado' });
    return;
  }
  const code = String(req.headers['x-2fa-code'] ?? '').trim();
  if (!code) {
    res.status(403).json({ ok: false, error: '2FA requerido', code: 'TWOFA_REQUIRED' });
    return;
  }
  if (!verifyCode(user, code)) {
    res
      .status(403)
      .json({ ok: false, error: 'Código 2FA inválido o expirado', code: 'TWOFA_INVALID' });
    return;
  }
  next();
}

/** Solo para tests: siembra un código sin enviar email. */
export function _seedCode(user: OtpUser, code: string, ttlMs: number = CODE_TTL_MS): void {
  pending.set(userKey(user), { code, expiresAt: Date.now() + ttlMs, failedAttempts: 0 });
}
