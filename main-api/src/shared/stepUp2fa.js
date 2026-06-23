// 2FA step-up (re-autenticación) para acciones destructivas/sensibles: borrar
// alarma, crear/eliminar usuario, etc. Genérico y reusable (CommonJS, lo usan
// las rutas v1).
//
// Flujo:
//   1. Cliente → POST /api/2fa/request → genera código de 6 dígitos y lo manda
//      al email del usuario (single-use, TTL 5min).
//   2. Cliente reintenta la acción con header `X-2FA-Code: <código>`.
//   3. require2fa valida y consume el código.
//
// Almacenamiento en memoria (single-instance, igual que el 2FA DGA existente).
// Multi-instance: migrar `pending` a Redis con TTL.

const crypto = require('crypto');
const { send2faCode } = require('../services/emailService');

const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_LEN = 6;

/** userId → { code, expiresAt }. Un código activo por usuario. */
const pending = new Map();

function userKey(user) {
  return String((user && (user.id || user.email)) || '');
}

function genCode() {
  // 6 dígitos uniformes (sin modulo bias).
  return String(crypto.randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0');
}

/** Genera un código nuevo y lo envía por email al usuario. Solo lo guarda si el
 * email salió OK (no reportar 200 sin haber entregado nada). */
async function requestCode(user) {
  const key = userKey(user);
  const to = user && user.email;
  if (!key || !to) {
    const e = new Error('Usuario sin email; no se puede enviar código 2FA');
    e.status = 400;
    throw e;
  }
  const code = genCode();
  const sent = await send2faCode({ to, code, minutes: Math.round(CODE_TTL_MS / 60000) });
  if (!sent || !sent.ok) {
    const e = new Error('No se pudo enviar el código 2FA por email');
    e.status = 502;
    throw e;
  }
  pending.set(key, { code, expiresAt: Date.now() + CODE_TTL_MS });
}

/** Verifica y consume (single-use) el código. timingSafeEqual contra timing attacks. */
function verifyCode(user, providedCode) {
  const key = userKey(user);
  const p = pending.get(key);
  if (!p) return false;
  if (Date.now() > p.expiresAt) {
    pending.delete(key);
    return false;
  }
  const expected = Buffer.from(p.code, 'utf8');
  const provided = Buffer.from(String(providedCode || '').slice(0, CODE_LEN), 'utf8');
  if (expected.length !== provided.length) return false;
  if (!crypto.timingSafeEqual(expected, provided)) return false;
  pending.delete(key); // single-use
  return true;
}

/** Middleware Express: exige header `X-2FA-Code` válido. */
function require2fa(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ ok: false, error: 'No autenticado' });
  const code = String(req.headers['x-2fa-code'] || '').trim();
  // 403 (no 401): el usuario está autenticado, solo falta el step-up. Evita que
  // el authInterceptor del frontend interprete 401 como sesión expirada y deslogue.
  if (!code) {
    return res.status(403).json({ ok: false, error: '2FA requerido', code: 'TWOFA_REQUIRED' });
  }
  if (!verifyCode(user, code)) {
    return res
      .status(403)
      .json({ ok: false, error: 'Código 2FA inválido o expirado', code: 'TWOFA_INVALID' });
  }
  next();
}

/** Solo para tests: siembra un código sin enviar email. */
function _seedCode(user, code, ttlMs = CODE_TTL_MS) {
  pending.set(userKey(user), { code, expiresAt: Date.now() + ttlMs });
}

module.exports = { requestCode, verifyCode, require2fa, _seedCode, CODE_TTL_MS };
