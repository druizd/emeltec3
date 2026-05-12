/**
 * Middleware global de errores.
 * Convierte excepciones internas en una respuesta JSON consistente para la API.
 */
function errorMiddleware(error, req, res, next) {
  const status = error.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} →`, error);

  return res.status(status).json({
    ok: false,
    message:
      isProd && status === 500
        ? 'Error interno del servidor'
        : error.message || 'Error interno del servidor',
  });
}

module.exports = errorMiddleware;
