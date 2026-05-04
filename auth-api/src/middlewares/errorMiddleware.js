function errorMiddleware(error, req, res, next) {
  const status = error.status || 500;
  const isProd  = process.env.NODE_ENV === 'production';
  const message = isProd && status === 500
    ? 'Error interno del servidor'
    : error.message || 'Error interno del servidor';

  console.error(`[auth-api][${new Date().toISOString()}] ${req.method} ${req.originalUrl} →`, error);

  return res.status(status).json({
    ok:      false,
    error:   message,
    message,
  });
}

module.exports = errorMiddleware;
