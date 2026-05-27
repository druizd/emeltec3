function errorMiddleware(error, req, res, next) {
  const status = error.status || 500;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    console.error(
      `[auth-api][${new Date().toISOString()}] ${req.method} ${req.originalUrl} status=${status}`,
      error.message,
      error.stack,
    );
  } else {
    console.error(
      `[auth-api][${new Date().toISOString()}] ${req.method} ${req.originalUrl} →`,
      error,
    );
  }

  const message =
    isProd && !error.status
      ? 'Error interno del servidor'
      : error.message || 'Error interno del servidor';

  return res.status(status).json({
    ok: false,
    error: message,
    message,
  });
}

module.exports = errorMiddleware;
