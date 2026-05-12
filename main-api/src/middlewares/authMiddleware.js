const jwt = require('jsonwebtoken');
const { requireEnv } = require('../config/requireEnv');

const JWT_SECRET = requireEnv('JWT_SECRET');

exports.protect = (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Acceso no autorizado. Token faltante.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email, tipo, empresa_id }
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
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
