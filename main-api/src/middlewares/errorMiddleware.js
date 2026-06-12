/**
 * Middleware global de errores.
 * Convierte excepciones internas en una respuesta JSON consistente para la API.
 *
 * Para AppError (módulos TS v2) propaga `error.code` y `error.details` en
 * `{error:{code,message,details?}}` — el frontend lee esa forma para detectar
 * códigos como `DGA_2FA_REQUIRED`. Mantiene `ok:false, message` a nivel raíz
 * para compatibilidad con consumidores legacy.
 */
let isAppError;
try {
  ({ isAppError } = require('../../dist/shared/errors'));
} catch (_e) {
  isAppError = () => false;
}

function errorMiddleware(error, req, res, _next) {
  const isApp = isAppError(error);
  const status = isApp ? error.status : error.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} →`, error);

  const expose = isApp ? error.expose : status < 500;
  const message = expose
    ? error.message
    : isProd && status === 500
      ? 'Error interno del servidor'
      : error.message || 'Error interno del servidor';

  const body = { ok: false, message };
  if (isApp) {
    const errObj = { code: error.code, message };
    if (error.details !== undefined && expose) errObj.details = error.details;
    body.error = errObj;
  }
  return res.status(status).json(body);
}

module.exports = errorMiddleware;
