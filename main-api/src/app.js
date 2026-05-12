/**
 * Punto central de configuracion de Express.
 * Aqui se conectan middlewares globales, rutas de la API y la demo estatica.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const healthRoutes = require('./routes/healthRoutes');
const statusRoutes = require('./routes/statusRoutes');
const dataRoutes = require('./routes/dataRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const userRoutes = require('./routes/userRoutes');
const companyRoutes = require('./routes/companyRoutes');
const alertaRoutes = require('./routes/alertaRoutes');
const internalRoutes = require('./routes/internalRoutes');
const errorMiddleware = require('./middlewares/errorMiddleware');

const app = express();

// Capa basica de seguridad HTTP.
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((o) => o.trim());

// CORS queda abierto por defecto en desarrollo, pero acepta lista blanca por variable de entorno.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
  }),
);

// Limite global para evitar abuso simple de la API.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes. Intenta en 15 minutos.' },
});

app.use('/api/', globalLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rutas funcionales del backend.
app.use('/api/health', healthRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/data', dataRoutes);
app.use('/api', catalogRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/alertas', alertaRoutes);

// /api/v2/* — router TS compilado. Endpoints nuevos con envelopes estándar,
// caché Redis online, Prometheus metrics, healthcheck liveness/readiness.
try {
  const v2Router = require('../dist/http/v2/routes').default;
  app.use('/api/v2', v2Router);
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') {
    console.warn('[main-api] No se pudo montar /api/v2:', err.message);
  }
}

// Ultimo middleware: normaliza errores de cualquier ruta anterior.
app.use(errorMiddleware);

module.exports = app;
