const jwt = require('jsonwebtoken');
const { requireEnv } = require('../config/requireEnv');
const { isSessionRevoked } = require('../services/sessionRevocation');
const {
  READ_ONLY_ERROR,
  actAsContext,
  isActAsToken,
  isReadOnlyMethod,
  isValidActAsToken,
  revocationSubject,
} = require('../services/actAs');

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

  // Token "ver como" (SuperAdmin simulando un rol): solo lectura.
  const actAs = isActAsToken(decoded);
  if (actAs) {
    if (!isValidActAsToken(decoded)) {
      return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
    }
    if (!isReadOnlyMethod(req.method)) {
      return res.status(403).json({ ok: false, error: READ_ONLY_ERROR });
    }
  }

  // Un cambio de contraseña corta las sesiones previas (sessions_valid_from).
  // Con "ver como" se evalúa contra el SuperAdmin real, no contra el id simulado.
  if (await isSessionRevoked(revocationSubject(decoded))) {
    return res.status(401).json({
      ok: false,
      error: 'Sesión cerrada por un cambio de contraseña. Vuelve a entrar.',
    });
  }

  req.user = decoded; // { id, email, tipo, empresa_id }
  if (actAs) req.actAs = actAsContext(decoded);
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
