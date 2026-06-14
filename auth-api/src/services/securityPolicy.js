/**
 * Políticas de seguridad puras (sin IO) para login y OTP.
 * Separadas del controlador para poder testearlas de forma aislada.
 *
 * Ver docs/security-audit/INFORME-AUDITORIA-SEGURIDAD-2026-06.md:
 *  - EMT-H08: lockout con backoff exponencial, sin recorte a 60s.
 *  - EMT-H09: ventana de OTP corta.
 */

// --- Lockout (EMT-H08) ---
const LOCKOUT_THRESHOLD = 5; // intentos fallidos antes del primer bloqueo
const LOCKOUT_BASE_MS = 15 * 60 * 1000; // 15 min en el umbral
const LOCKOUT_MAX_MS = 4 * 60 * 60 * 1000; // tope 4 h

// --- OTP (EMT-H09) ---
const DEFAULT_OTP_MINS = 10;
const MIN_OTP_MINS = 1;
const MAX_OTP_MINS = 15;

/**
 * Duración del bloqueo según el total de fallos acumulados.
 * Backoff exponencial desde el umbral, con tope. 0 = sin bloqueo.
 */
function lockoutDurationMs(failedLogins) {
  const failed = Number(failedLogins) || 0;
  if (failed < LOCKOUT_THRESHOLD) return 0;
  const over = failed - LOCKOUT_THRESHOLD;
  return Math.min(LOCKOUT_BASE_MS * 2 ** over, LOCKOUT_MAX_MS);
}

/**
 * Evalúa el estado de bloqueo a partir del locked_until almacenado.
 * NO recorta la duración (ese era el bug EMT-H08). Devuelve
 * { locked, expired, remainingMs }.
 */
function evaluateLock(lockedUntil, now = Date.now()) {
  if (!lockedUntil) return { locked: false, expired: false, remainingMs: 0 };
  const until = new Date(lockedUntil).getTime();
  if (!Number.isFinite(until)) return { locked: false, expired: false, remainingMs: 0 };
  if (until <= now) return { locked: false, expired: true, remainingMs: 0 };
  return { locked: true, expired: false, remainingMs: until - now };
}

/** Minutos restantes de bloqueo (redondeo hacia arriba, mínimo 1). */
function remainingLockMinutes(remainingMs) {
  return Math.max(1, Math.ceil(remainingMs / 60000));
}

/** Normaliza los minutos de validez del OTP al rango permitido. */
function clampOtpMinutes(requested) {
  const n = parseInt(requested, 10);
  if (!Number.isFinite(n) || n < MIN_OTP_MINS) return DEFAULT_OTP_MINS;
  return Math.min(n, MAX_OTP_MINS);
}

module.exports = {
  LOCKOUT_THRESHOLD,
  LOCKOUT_BASE_MS,
  LOCKOUT_MAX_MS,
  DEFAULT_OTP_MINS,
  MIN_OTP_MINS,
  MAX_OTP_MINS,
  lockoutDurationMs,
  evaluateLock,
  remainingLockMinutes,
  clampOtpMinutes,
};
