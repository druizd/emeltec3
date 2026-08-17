const jwt = require('jsonwebtoken');
const { requireEnv } = require('../config/requireEnv');
const { isSessionRevoked } = require('../services/sessionRevocation');

const JWT_SECRET = requireEnv('JWT_SECRET');

exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Acceso no autorizado. Token faltante.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }

  // Un cambio de contraseña corta las sesiones previas (sessions_valid_from).
  if (await isSessionRevoked(decoded)) {
    return res.status(401).json({
      ok: false,
      error: 'Sesión cerrada por un cambio de contraseña. Vuelve a entrar.',
    });
  }

  req.user = decoded; // { id, email, tipo, empresa_id }
  next();
};

// Middleware para autorizar roles específicos
exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.tipo)) {
      return res.status(403).json({
        ok: false,
        error: `El rol ${req.user ? req.user.tipo : 'desconocido'} no tiene acceso a esta acción`,
      });
    }
    next();
  };
};
