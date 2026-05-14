const crypto = require('crypto');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { jwtSecret, mainApiUrl, internalApiKey } = require('../config/env');
const audit = require('../services/auditLog');

const DEFAULT_OTP_MINS = 30;
const MAX_OTP_MINS = 1440;

// Hardening parameters (Ley 21.663 §32 — controles mínimos).
const BCRYPT_COST = 12; // hash strength
const LOCKOUT_THRESHOLD = 5; // intentos fallidos antes de bloquear
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 min bloqueo
const OTP_RATE_LIMIT_MAX = 3; // max solicitudes OTP
const OTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // por ventana 15 min

async function dispararCorreoOtp(email, nombre, code, minutes) {
  const res = await fetch(`${mainApiUrl}/api/internal/email/otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': internalApiKey,
    },
    body: JSON.stringify({ email, nombre, code, minutes }),
  });

  const payload = await leerRespuestaJson(res);

  if (!res.ok) {
    const err = new Error(
      payload.error || payload.message || 'No se pudo enviar el codigo por correo.',
    );
    err.status = 502;
    throw err;
  }

  if (!payload.ok) {
    const err = new Error(payload.error || 'No se pudo enviar el codigo por correo.');
    err.status = 502;
    throw err;
  }

  return payload;
}

async function leerRespuestaJson(res) {
  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function clientIp(req) {
  return (req.ip || req.headers['x-forwarded-for'] || '').toString().slice(0, 45) || null;
}

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y password son requeridos' });
    }

    const result = await db.query(
      `SELECT id, nombre, email, tipo, empresa_id, sub_empresa_id,
              password_hash, otp_hash, otp_expires_at,
              failed_logins, locked_until
       FROM usuario WHERE email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      await audit.record({
        req,
        action: 'login.failure',
        actorEmail: email,
        statusCode: 401,
        metadata: { reason: 'user_not_found' },
      });
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];

    // ── Lockout check ──────────────────────────────────────────────
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await audit.record({
        req,
        action: 'login.blocked',
        actorId: user.id,
        actorEmail: user.email,
        actorTipo: user.tipo,
        statusCode: 423,
        metadata: { reason: 'account_locked', until: user.locked_until },
      });
      return res.status(423).json({
        ok: false,
        error: 'Cuenta temporalmente bloqueada por múltiples intentos fallidos. Intenta más tarde.',
      });
    }

    let authenticated = false;
    let authMethod = null;

    if (user.otp_hash) {
      const otpExpired = user.otp_expires_at && new Date() > new Date(user.otp_expires_at);
      if (!otpExpired) {
        const otpMatch = await bcrypt.compare(password, user.otp_hash);
        if (otpMatch) {
          await db.query(
            'UPDATE usuario SET otp_hash = NULL, otp_expires_at = NULL WHERE email = $1',
            [email],
          );
          authenticated = true;
          authMethod = 'otp';
        }
      }
    }

    if (!authenticated && user.password_hash) {
      const passMatch = await bcrypt.compare(password, user.password_hash);
      if (passMatch) {
        authenticated = true;
        authMethod = 'password';
      }
    }

    if (!authenticated) {
      // Incrementa contador. A los LOCKOUT_THRESHOLD bloquea LOCKOUT_DURATION_MS.
      const newFailed = (user.failed_logins || 0) + 1;
      const shouldLock = newFailed >= LOCKOUT_THRESHOLD;
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

      await db.query(
        `UPDATE usuario
         SET failed_logins = $1,
             locked_until  = COALESCE($2, locked_until)
         WHERE email = $3`,
        [newFailed, lockedUntil, email],
      );

      await audit.record({
        req,
        action: shouldLock ? 'login.locked' : 'login.failure',
        actorId: user.id,
        actorEmail: user.email,
        actorTipo: user.tipo,
        statusCode: 401,
        metadata: {
          reason: 'invalid_credentials',
          failed_logins: newFailed,
          locked_until: lockedUntil,
        },
      });

      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    // ── Login exitoso ─────────────────────────────────────────────
    await db.query(
      `UPDATE usuario
       SET failed_logins  = 0,
           locked_until   = NULL,
           last_login_at  = NOW(),
           last_login_ip  = $1
       WHERE email = $2`,
      [clientIp(req), email],
    );

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        tipo: user.tipo,
        empresa_id: user.empresa_id,
        sub_empresa_id: user.sub_empresa_id,
      },
      jwtSecret,
      { expiresIn: '12h', algorithm: 'HS256' },
    );

    await audit.record({
      req,
      action: 'login.success',
      actorId: user.id,
      actorEmail: user.email,
      actorTipo: user.tipo,
      statusCode: 200,
      metadata: { method: authMethod },
    });

    res.json({
      ok: true,
      token,
      user: {
        nombre: user.nombre,
        email: user.email,
        tipo: user.tipo,
        empresa_id: user.empresa_id,
        sub_empresa_id: user.sub_empresa_id,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.requestCode = async (req, res, next) => {
  try {
    const { email, expires_minutes } = req.body;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'El correo es requerido' });
    }

    let minutes = parseInt(expires_minutes) || DEFAULT_OTP_MINS;
    if (minutes < 1) minutes = DEFAULT_OTP_MINS;
    if (minutes > MAX_OTP_MINS) minutes = MAX_OTP_MINS;

    const result = await db.query(
      `SELECT id, nombre, email, otp_requests_count, otp_requests_window_start
       FROM usuario WHERE email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      await audit.record({
        req,
        action: 'otp.request.unknown_email',
        actorEmail: email,
        statusCode: 403,
      });
      return res.status(403).json({
        ok: false,
        error: 'Este correo no ha sido autorizado en el sistema. Contacte a su administrador.',
      });
    }

    const usr = result.rows[0];

    // ── Rate limit OTP por email ─────────────────────────────────
    const now = new Date();
    const windowStart = usr.otp_requests_window_start
      ? new Date(usr.otp_requests_window_start)
      : null;
    const windowExpired =
      !windowStart || now.getTime() - windowStart.getTime() > OTP_RATE_LIMIT_WINDOW_MS;
    const currentCount = windowExpired ? 0 : usr.otp_requests_count || 0;

    if (currentCount >= OTP_RATE_LIMIT_MAX) {
      await audit.record({
        req,
        action: 'otp.request.rate_limited',
        actorId: usr.id,
        actorEmail: usr.email,
        statusCode: 429,
        metadata: { count: currentCount, window_start: windowStart },
      });
      return res.status(429).json({
        ok: false,
        error: `Demasiadas solicitudes. Reintenta en ${Math.ceil(OTP_RATE_LIMIT_WINDOW_MS / 60000)} minutos.`,
      });
    }

    // OTP via CSPRNG (no Math.random — predecible).
    const OTP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const otpCode = Array.from(
      { length: 6 },
      () => OTP_CHARS[crypto.randomInt(0, OTP_CHARS.length)],
    ).join('');
    const otpHash = await bcrypt.hash(otpCode, BCRYPT_COST);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    await db.query(
      `UPDATE usuario
       SET otp_hash                  = $1,
           otp_expires_at            = $2,
           otp_requests_count        = $3,
           otp_requests_window_start = $4
       WHERE email = $5`,
      [otpHash, expiresAt, currentCount + 1, windowExpired ? now : windowStart, email],
    );

    try {
      await dispararCorreoOtp(email, usr.nombre, otpCode, minutes);
    } catch (err) {
      try {
        await db.query(
          'UPDATE usuario SET otp_hash = NULL, otp_expires_at = NULL WHERE email = $1 AND otp_hash = $2',
          [email, otpHash],
        );
      } catch (cleanupErr) {
        console.error('[auth-api] No se pudo limpiar el OTP fallido:', cleanupErr);
      }
      await audit.record({
        req,
        action: 'otp.request.email_failed',
        actorId: usr.id,
        actorEmail: usr.email,
        statusCode: 502,
        metadata: { error: err.message },
      });
      throw err;
    }

    await audit.record({
      req,
      action: 'otp.request.success',
      actorId: usr.id,
      actorEmail: usr.email,
      statusCode: 200,
      metadata: { expires_minutes: minutes, count_in_window: currentCount + 1 },
    });

    res.json({
      ok: true,
      message: `Código enviado exitosamente. Válido por ${minutes} minutos.`,
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
};
