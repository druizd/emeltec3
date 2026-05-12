const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('../services/emailService');
const { requireEnv } = require('../config/requireEnv');

const JWT_SECRET = requireEnv('JWT_SECRET');
const DEFAULT_OTP_MINS = 30;
const MAX_OTP_MINS = 1440; // 24 horas máximo

/**
 * POST /api/auth/login
 * Acepta:
 *   1. Código OTP enviado al correo  → verifica otp_hash + expiración
 *   2. Contraseña fija (ej: 1234)    → verifica password_hash directamente
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y password son requeridos' });
    }

    // Buscar al usuario (ahora incluye otp_hash y otp_expires_at)
    const result = await db.query(
      `SELECT id, nombre, email, tipo, empresa_id, sub_empresa_id,
              password_hash, otp_hash, otp_expires_at
       FROM usuario WHERE email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    const unUsuario = result.rows[0];
    let authenticated = false;

    // 1️⃣ Intentar con OTP (si tiene uno pendiente y no ha expirado)
    if (unUsuario.otp_hash) {
      const otpExpired =
        unUsuario.otp_expires_at && new Date() > new Date(unUsuario.otp_expires_at);

      if (!otpExpired) {
        const otpMatch = await bcrypt.compare(password, unUsuario.otp_hash);
        if (otpMatch) {
          // Invalidar OTP después de usarlo (un solo uso)
          await db.query(
            'UPDATE usuario SET otp_hash = NULL, otp_expires_at = NULL WHERE email = $1',
            [email],
          );
          authenticated = true;
        }
      }
    }

    // 2️⃣ Si no autenticó con OTP, intentar con contraseña fija
    if (!authenticated && unUsuario.password_hash) {
      const passMatch = await bcrypt.compare(password, unUsuario.password_hash);
      if (passMatch) authenticated = true;
    }

    if (!authenticated) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    // Firmar JWT
    const payload = {
      id: unUsuario.id,
      email: unUsuario.email,
      tipo: unUsuario.tipo,
      empresa_id: unUsuario.empresa_id,
      sub_empresa_id: unUsuario.sub_empresa_id,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

    res.json({
      ok: true,
      token,
      user: {
        nombre: unUsuario.nombre,
        email: unUsuario.email,
        tipo: unUsuario.tipo,
        empresa_id: unUsuario.empresa_id,
        sub_empresa_id: unUsuario.sub_empresa_id,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/request-code
 * Genera OTP, lo guarda en otp_hash (SIN tocar password_hash) y lo envía por correo.
 * Ahora el código expira en 30 minutos por defecto.
 */
exports.requestCode = async (req, res, next) => {
  try {
    const { email, expires_minutes } = req.body;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'El correo es requerido' });
    }

    // Calcular minutos de expiración
    let minutes = parseInt(expires_minutes) || DEFAULT_OTP_MINS;
    if (minutes < 1) minutes = DEFAULT_OTP_MINS;
    if (minutes > MAX_OTP_MINS) minutes = MAX_OTP_MINS;

    // 1. Validar que el usuario fue ingresado en la BDD por un Admin
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

    // 2. Generar Código Alfanumérico de 6 caracteres
    const otpCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const saltRounds = 10;
    const otpHash = await bcrypt.hash(otpCode, saltRounds);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    // 3. Guardar OTP en columna separada — password_hash NO se toca
    await db.query('UPDATE usuario SET otp_hash = $1, otp_expires_at = $2 WHERE email = $3', [
      otpHash,
      expiresAt,
      email,
    ]);

    // 4. Enviar OTP al correo
    const emailInfo = await emailService.sendWelcomeEmail(email, usr.nombre, otpCode);

    res.json({
      ok: true,
      message: `Código enviado exitosamente. Válido por ${minutes} minutos.`,
      expires_at: expiresAt.toISOString(),
      previewUrl: emailInfo.previewUrl || null,
    });
  } catch (error) {
    next(error);
  }
};
