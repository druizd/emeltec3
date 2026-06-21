const crypto = require('crypto');
const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { jwtSecret, mainApiUrl, internalApiKey } = require('../config/env');
const audit = require('../services/auditLog');

const {
  DEFAULT_OTP_MINS,
  lockoutDurationMs,
  evaluateLock,
  remainingLockMinutes,
  clampOtpMinutes,
} = require('../services/securityPolicy');

// Política de seguridad: la sesión dura 1 hora, sin refresh ni extensión silenciosa.
const AUTH_TOKEN_TTL = '1h';

const BCRYPT_COST = 12;
const OTP_RATE_LIMIT_MAX = 5;
const OTP_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function allowsPasswordLogin(user) {
  return user.auth_mode === 'password' || user.auth_mode === 'password_otp';
}

function allowsOtpLogin(user) {
  return user.auth_mode === 'otp';
}

function requiresMfa(user) {
  return user.auth_mode === 'password_otp';
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
  if (!res.ok || !payload.ok) {
    const err = new Error(
      payload.error || payload.message || 'No se pudo enviar el codigo por correo.',
    );
    err.status = 502;
    throw err;
  }

  return payload;
}

function clientIp(req) {
  // Solo req.ip (Express lo resuelve vía trust proxy). No el X-Forwarded-For
  // crudo, que el cliente puede falsificar.
  return (req.ip || '').toString().slice(0, 45) || null;
}

function makeOtpCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
}

function makeAuthToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      tipo: user.tipo,
      empresa_id: user.empresa_id,
      sub_empresa_id: user.sub_empresa_id,
    },
    jwtSecret,
    { expiresIn: AUTH_TOKEN_TTL, algorithm: 'HS256' },
  );
}

async function storeOtpForUser(email, minutes = DEFAULT_OTP_MINS) {
  const otpCode = makeOtpCode();
  const otpHash = await bcrypt.hash(otpCode, BCRYPT_COST);
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  await db.query('UPDATE usuario SET otp_hash = $1, otp_expires_at = $2 WHERE email = $3', [
    otpHash,
    expiresAt,
    email,
  ]);
  return { otpCode, expiresAt };
}

async function finishLogin(req, res, user, authMethod) {
  await db.query(
    `UPDATE usuario
     SET failed_logins = 0,
         locked_until = NULL,
         last_login_at = NOW(),
         last_login_ip = $1
     WHERE email = $2`,
    [clientIp(req), user.email],
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
    token: makeAuthToken(user),
    user: {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido || '',
      email: user.email,
      tipo: user.tipo,
      empresa_id: user.empresa_id,
      sub_empresa_id: user.sub_empresa_id,
    },
  });
}

async function recordFailedLogin(req, user, email) {
  const newFailed = (user.failed_logins || 0) + 1;
  // EMT-H08: backoff exponencial según fallos acumulados (sin recorte).
  const durationMs = lockoutDurationMs(newFailed);
  const shouldLock = durationMs > 0;
  const lockedUntil = shouldLock ? new Date(Date.now() + durationMs) : null;

  // EMT-H11: el OTP es de UN SOLO USO → se invalida en CADA intento fallido
  // (antes solo al bloquear), para que un código no quede reusable entre intentos.
  await db.query(
    `UPDATE usuario
     SET failed_logins = $1,
         locked_until = COALESCE($2, locked_until),
         otp_hash = NULL,
         otp_expires_at = NULL
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
}

async function verifyOtpCredential(user, credential) {
  const otpExpired = user.otp_expires_at && new Date() > new Date(user.otp_expires_at);
  return !!user.otp_hash && !otpExpired && (await bcrypt.compare(credential, user.otp_hash));
}

async function findAuthUserByEmail(email) {
  const { rows } = await db.query(
    `SELECT id, nombre, apellido, email, tipo, empresa_id, sub_empresa_id,
            password_hash, otp_hash, otp_expires_at, failed_logins, locked_until,
            auth_mode, COALESCE(activo, true) AS activo,
            activated_at, otp_requests_count, otp_requests_window_start
     FROM usuario WHERE email = $1`,
    [email],
  );

  return rows[0] || null;
}

async function rejectUnknownEmail(req, email, res) {
  await audit.record({
    req,
    action: 'login.failure',
    actorEmail: email,
    statusCode: 401,
    metadata: { reason: 'user_not_found' },
  });
  return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
}

async function ensureNotLocked(req, user, res) {
  const state = evaluateLock(user.locked_until);

  if (!state.locked) {
    // EMT-H08: al expirar el bloqueo liberamos SOLO locked_until y conservamos
    // failed_logins, para que un nuevo fallo escale el siguiente bloqueo en vez
    // de regalar otra tanda de intentos desde cero.
    if (state.expired) {
      await db.query('UPDATE usuario SET locked_until = NULL WHERE email = $1', [user.email]);
    }
    return false;
  }

  const minutes = remainingLockMinutes(state.remainingMs);

  await audit.record({
    req,
    action: 'login.blocked',
    actorId: user.id,
    actorEmail: user.email,
    actorTipo: user.tipo,
    statusCode: 423,
    metadata: { reason: 'account_locked', remaining_minutes: minutes },
  });

  res.status(423).json({
    ok: false,
    error: `Cuenta bloqueada por multiples intentos fallidos. Intenta nuevamente en ${minutes} ${
      minutes === 1 ? 'minuto' : 'minutos'
    }.`,
  });
  return true;
}

async function issueOtp(req, user, minutes, { ignorePreference = false, action } = {}) {
  if (!ignorePreference && !allowsOtpLogin(user)) {
    const err = new Error('Ingreso con codigo OTP desactivado.');
    err.status = 403;
    throw err;
  }

  const now = new Date();
  const windowStart = user.otp_requests_window_start
    ? new Date(user.otp_requests_window_start)
    : null;
  const windowExpired =
    !windowStart || now.getTime() - windowStart.getTime() > OTP_RATE_LIMIT_WINDOW_MS;
  const currentCount = windowExpired ? 0 : user.otp_requests_count || 0;

  if (currentCount >= OTP_RATE_LIMIT_MAX) {
    await audit.record({
      req,
      action: 'otp.request.rate_limited',
      actorId: user.id,
      actorEmail: user.email,
      statusCode: 429,
      metadata: { count: currentCount, window_start: windowStart },
    });

    const retryMinutes = Math.ceil(OTP_RATE_LIMIT_WINDOW_MS / 60000);
    const err = new Error(
      `Demasiadas solicitudes. Reintenta en ${retryMinutes} ${retryMinutes === 1 ? 'minuto' : 'minutos'}.`,
    );
    err.status = 429;
    throw err;
  }

  const { otpCode, expiresAt } = await storeOtpForUser(user.email, minutes);
  await db.query(
    `UPDATE usuario
     SET otp_requests_count = $1,
         otp_requests_window_start = $2
     WHERE email = $3`,
    [currentCount + 1, windowExpired ? now : windowStart, user.email],
  );

  try {
    await dispararCorreoOtp(user.email, user.nombre, otpCode, minutes);
  } catch (err) {
    try {
      await db.query('UPDATE usuario SET otp_hash = NULL, otp_expires_at = NULL WHERE email = $1', [
        user.email,
      ]);
    } catch (cleanupErr) {
      console.error('[auth-api] No se pudo limpiar el OTP fallido:', cleanupErr);
    }

    await audit.record({
      req,
      action: 'otp.request.email_failed',
      actorId: user.id,
      actorEmail: user.email,
      statusCode: 502,
      metadata: { error: err.message },
    });
    throw err;
  }

  await audit.record({
    req,
    action: action || 'otp.request.success',
    actorId: user.id,
    actorEmail: user.email,
    statusCode: 200,
    metadata: { expires_minutes: minutes, count_in_window: currentCount + 1 },
  });

  return { expiresAt };
}

async function sendMfaChallenge(req, res, user) {
  await issueOtp(req, user, DEFAULT_OTP_MINS, {
    ignorePreference: true,
    action: 'login.mfa_code_sent',
  });
  const challengeToken = jwt.sign({ email: user.email, purpose: 'mfa' }, jwtSecret, {
    expiresIn: '10m',
    algorithm: 'HS256',
  });

  await audit.record({
    req,
    action: 'login.mfa_required',
    actorId: user.id,
    actorEmail: user.email,
    actorTipo: user.tipo,
    statusCode: 200,
  });

  return res.json({
    ok: true,
    requires_otp: true,
    challenge_token: challengeToken,
    message: 'Codigo OTP enviado para completar el ingreso.',
  });
}

exports.startLogin = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'El correo es requerido.' });

    const user = await findAuthUserByEmail(email);
    if (!user) {
      // EMT-H10 (anti-enumeración): no revelar si el correo existe. Respondemos
      // como una cuenta con contraseña; un intento posterior dará el 401 genérico.
      await audit.record({
        req,
        action: 'login.start.unknown_email',
        actorEmail: email,
        statusCode: 200,
        metadata: { reason: 'user_not_found' },
      });
      return res.json({ ok: true, flow: 'password', message: 'Ingresa tu contrasena.' });
    }
    if (await ensureNotLocked(req, user, res)) return;

    if (!user.activated_at) {
      return res.json({
        ok: true,
        flow: 'setup',
        message: 'Cuenta nueva. Crea una contrasena para activar el acceso.',
      });
    }

    if (allowsPasswordLogin(user) && user.password_hash) {
      return res.json({
        ok: true,
        flow: 'password',
        message: 'Ingresa tu contrasena.',
      });
    }

    if (allowsOtpLogin(user)) {
      const { expiresAt } = await issueOtp(req, user, DEFAULT_OTP_MINS, {
        action: 'login.otp_code_sent',
      });
      return res.json({
        ok: true,
        flow: 'otp',
        message: 'Codigo enviado a tu correo.',
        expires_at: expiresAt.toISOString(),
      });
    }

    return res
      .status(403)
      .json({ ok: false, error: 'La cuenta no tiene metodos de ingreso activos.' });
  } catch (err) {
    next(err);
  }
};

exports.startSetup = async (req, res, next) => {
  try {
    const { email, new_password } = req.body;
    const password = String(new_password || '');

    if (!email) return res.status(400).json({ ok: false, error: 'El correo es requerido.' });
    if (password.length < 8) {
      return res
        .status(400)
        .json({ ok: false, error: 'La contrasena debe tener al menos 8 caracteres.' });
    }

    const user = await findAuthUserByEmail(email);
    if (!user) return rejectUnknownEmail(req, email, res);
    if (await ensureNotLocked(req, user, res)) return;
    if (user.activated_at) {
      return res.status(409).json({ ok: false, error: 'Esta cuenta ya fue activada.' });
    }

    const { expiresAt } = await issueOtp(req, user, DEFAULT_OTP_MINS, {
      ignorePreference: true,
      action: 'account_setup.otp_sent',
    });
    const setupToken = jwt.sign({ email: user.email, purpose: 'account_setup' }, jwtSecret, {
      expiresIn: '10m',
      algorithm: 'HS256',
    });

    return res.json({
      ok: true,
      setup_token: setupToken,
      expires_at: expiresAt.toISOString(),
      message: 'Codigo enviado a tu correo para confirmar la activacion.',
    });
  } catch (err) {
    next(err);
  }
};

exports.completeSetup = async (req, res, next) => {
  try {
    const { email, new_password, otp_code, setup_token } = req.body;
    const password = String(new_password || '');

    if (!email || !otp_code || !setup_token) {
      return res.status(400).json({ ok: false, error: 'Correo, codigo y token son requeridos.' });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ ok: false, error: 'La contrasena debe tener al menos 8 caracteres.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(setup_token, jwtSecret, { algorithms: ['HS256'] });
      if (decoded.email !== email || decoded.purpose !== 'account_setup') throw new Error();
    } catch {
      return res
        .status(401)
        .json({ ok: false, error: 'La activacion expiro. Solicita otro codigo.' });
    }

    const user = await findAuthUserByEmail(email);
    if (!user) return rejectUnknownEmail(req, email, res);
    if (await ensureNotLocked(req, user, res)) return;
    if (user.activated_at) {
      return res.status(409).json({ ok: false, error: 'Esta cuenta ya fue activada.' });
    }

    const validOtp = await verifyOtpCredential(user, String(otp_code));
    if (!validOtp) {
      await recordFailedLogin(req, user, email);
      return res.status(401).json({ ok: false, error: 'Codigo invalido o expirado.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await db.query(
      `UPDATE usuario
       SET password_hash = $1,
           password_set_at = NOW(),
           auth_mode = 'password',
           activated_at = NOW(),
           otp_hash = NULL,
           otp_expires_at = NULL,
           failed_logins = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE email = $2`,
      [passwordHash, email],
    );

    await audit.record({
      req,
      action: 'account_setup.success',
      actorId: user.id,
      actorEmail: user.email,
      actorTipo: user.tipo,
      statusCode: 200,
    });

    return finishLogin(req, res, user, 'setup_password');
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password, mode, otp_code, challenge_token } = req.body;
    const loginMode = mode || 'auto';
    const credential = loginMode === 'mfa' ? otp_code || password : password;

    if (!email || !credential) {
      return res.status(400).json({ ok: false, error: 'Email y credencial son requeridos' });
    }
    if (!['auto', 'otp', 'password', 'mfa'].includes(loginMode)) {
      return res.status(400).json({ ok: false, error: 'Metodo de inicio no valido.' });
    }

    const user = await findAuthUserByEmail(email);
    if (!user) return rejectUnknownEmail(req, email, res);
    if (await ensureNotLocked(req, user, res)) return;
    // EMT-H10/M-1: no revelar estado de la cuenta vía /login. Una cuenta no
    // activada se enruta por /start (flow:'setup'); aquí respondemos genérico.
    if (!user.activated_at) {
      return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    }
    // Usuario desactivado (soft-delete): no puede ingresar. Genérico para no
    // revelar el estado de la cuenta (anti-enumeración).
    if (!user.activo) {
      return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    }

    let authenticated = false;
    let authMethod = loginMode;

    if (loginMode === 'password') {
      if (!allowsPasswordLogin(user) || !user.password_hash) {
        // No revelar qué método de ingreso tiene la cuenta (anti-enumeración).
        return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
      }

      authenticated = await bcrypt.compare(credential, user.password_hash);
      authMethod = 'password';

      if (authenticated && requiresMfa(user)) {
        return sendMfaChallenge(req, res, user);
      }
    } else if (loginMode === 'mfa') {
      try {
        const decoded = jwt.verify(challenge_token || '', jwtSecret, { algorithms: ['HS256'] });
        if (decoded.email !== user.email || decoded.purpose !== 'mfa') {
          throw new Error('invalid challenge');
        }
      } catch {
        return res.status(401).json({ ok: false, error: 'Verificacion 2FA expirada.' });
      }

      authenticated = await verifyOtpCredential(user, credential);
      authMethod = 'password_otp';
    } else if (loginMode === 'otp') {
      if (!allowsOtpLogin(user)) {
        return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
      }

      authenticated = await verifyOtpCredential(user, credential);
      authMethod = 'otp';
    } else {
      if (allowsOtpLogin(user)) {
        authenticated = await verifyOtpCredential(user, credential);
        if (authenticated) authMethod = 'otp';
      }

      if (!authenticated && allowsPasswordLogin(user) && user.password_hash) {
        authenticated = await bcrypt.compare(credential, user.password_hash);
        authMethod = 'password';
        if (authenticated && requiresMfa(user)) {
          return sendMfaChallenge(req, res, user);
        }
      }
    }

    if (!authenticated) {
      await recordFailedLogin(req, user, email);
      return res.status(401).json({ ok: false, error: 'Credenciales invalidas' });
    }

    if (authMethod === 'otp' || authMethod === 'password_otp') {
      await db.query('UPDATE usuario SET otp_hash = NULL, otp_expires_at = NULL WHERE email = $1', [
        email,
      ]);
    }

    await finishLogin(req, res, user, authMethod);
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

    const minutes = clampOtpMinutes(expires_minutes); // EMT-H09: ventana acotada
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    // EMT-H10 (anti-enumeración): respuesta uniforme. No revela si el correo
    // existe, está activado, bloqueado o qué método de ingreso usa.
    const generic = {
      ok: true,
      message: 'Si el correo esta registrado y habilitado, recibiras un codigo.',
      expires_at: expiresAt.toISOString(),
    };

    const usr = await findAuthUserByEmail(email);
    if (!usr) {
      await audit.record({
        req,
        action: 'otp.request.unknown_email',
        actorEmail: email,
        statusCode: 200,
      });
      return res.json(generic);
    }

    // Solo emitimos para cuentas activas, no bloqueadas y con OTP habilitado.
    // En cualquier otro caso devolvemos la misma respuesta genérica.
    if (evaluateLock(usr.locked_until).locked || !usr.activated_at || !allowsOtpLogin(usr)) {
      return res.json(generic);
    }

    await issueOtp(req, usr, minutes);
    return res.json(generic);
  } catch (err) {
    next(err);
  }
};
