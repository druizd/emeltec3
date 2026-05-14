const crypto = require('crypto');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { jwtSecret, mainApiUrl, internalApiKey } = require('../config/env');

const DEFAULT_OTP_MINS = 30;
const MAX_OTP_MINS = 1440;

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

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y password son requeridos' });
    }

    const result = await db.query(
      `SELECT id, nombre, email, tipo, empresa_id, sub_empresa_id,
              password_hash, otp_hash, otp_expires_at
       FROM usuario WHERE email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];
    let authenticated = false;

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
        }
      }
    }

    if (!authenticated && user.password_hash) {
      const passMatch = await bcrypt.compare(password, user.password_hash);
      if (passMatch) authenticated = true;
    }

    if (!authenticated) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        tipo: user.tipo,
        empresa_id: user.empresa_id,
        sub_empresa_id: user.sub_empresa_id,
      },
      jwtSecret,
      { expiresIn: '12h' },
    );

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

    const result = await db.query('SELECT id, nombre, email FROM usuario WHERE email = $1', [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(403).json({
        ok: false,
        error: 'Este correo no ha sido autorizado en el sistema. Contacte a su administrador.',
      });
    }

    const usr = result.rows[0];
    // OTP via CSPRNG (crypto.randomInt) — Math.random no es criptográficamente
    // seguro (estado xorshift128+ predecible tras pocas observaciones).
    const OTP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const otpCode = Array.from(
      { length: 6 },
      () => OTP_CHARS[crypto.randomInt(0, OTP_CHARS.length)],
    ).join('');
    const otpHash = await bcrypt.hash(otpCode, 10);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    await db.query('UPDATE usuario SET otp_hash = $1, otp_expires_at = $2 WHERE email = $3', [
      otpHash,
      expiresAt,
      email,
    ]);

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
      throw err;
    }

    res.json({
      ok: true,
      message: `Código enviado exitosamente. Válido por ${minutes} minutos.`,
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
};
