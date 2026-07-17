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
const incidenciaRoutes = require('./routes/incidenciaRoutes');
const documentoRoutes = require('./routes/documentoRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const internalRoutes = require('./routes/internalRoutes');
const coldRoomRoutes = require('./routes/coldRoomRoutes');
const twoFactorRoutes = require('./routes/twoFactorRoutes');
const errorMiddleware = require('./middlewares/errorMiddleware');
const { auditMutations } = require('./services/auditLog');

const app = express();

// Detrás del nginx de borde de la VM (proxy directo a 127.0.0.1:3000 — ver
// EMT-H03 en docker-compose). Para que req.ip sea la IP real del cliente el
// borde DEBE enviar `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
// — sin ese header, req.ip cae a la IP del propio borde ("la del servidor",
// bug del audit_log detectado 17-07-2026). Hops ajustables por env si la
// topología cambia (p. ej. si /api pasara por el nginx del contenedor: 2).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

// Capa basica de seguridad HTTP.
app.use(helmet());

// Orígenes extra opcionales (staging, etc.) por variable de entorno. Ya NO
// hay '*' por defecto (fail-closed).
const extraOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// CORS: subdominios de emeltec.cl (https) + localhost (dev) + extras por env.
// Sin Origin (server-to-server / curl) se permite.
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (extraOrigins.includes(origin)) return true;
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === 'emeltec.cl' || host.endsWith('.emeltec.cl')) return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return false;
}

app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    // Server-Timing necesita estar en la lista expuesta para que DevTools del
    // browser lo lea en peticiones cross-origin.
    exposedHeaders: ['Server-Timing'],
  }),
);

// Limite global opcional para evitar abuso simple de la API.
// RATE_LIMIT_MAX=0 o RATE_LIMIT_WINDOW_MS=0 lo deshabilita.
const rateLimitWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '3600000', 10);
const rateLimitMax = Number.parseInt(process.env.RATE_LIMIT_MAX || '5000', 10);

if (rateLimitWindowMs > 0 && rateLimitMax > 0) {
  const globalLimiter = rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      message: 'Demasiadas solicitudes. Intenta nuevamente en unos momentos.',
    },
  });

  app.use('/api/', globalLimiter);
}
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Bitácora automática Ley 21.663: registra mutaciones (POST/PUT/PATCH/DELETE)
// en /api/users, /api/companies, /api/alertas tras ejecutarse el handler.
// El resolver mapea cada path → action key (e.g. POST /api/users → 'usuario.create').
const auditResolver = (req) => {
  const path = req.originalUrl.split('?')[0];
  let targetType = null;
  if (path.startsWith('/api/users')) targetType = 'usuario';
  else if (path.startsWith('/api/companies')) targetType = 'empresa';
  else if (path.startsWith('/api/eventos')) targetType = 'evento';
  else if (path.startsWith('/api/alertas')) targetType = 'alerta';
  else if (path.startsWith('/api/incidencias')) targetType = 'incidencia';
  else if (path.startsWith('/api/documentos')) targetType = 'documento';
  const verb =
    { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[req.method] || 'mutate';
  // El id aparece como último segmento numérico/alfanumérico tras la base de recursos.
  const targetId = (req.params && (req.params.id || req.params.sitioId)) || null;
  return {
    action: targetType ? `${targetType}.${verb}` : `${req.method.toLowerCase()}.unknown`,
    targetType,
    targetId,
  };
};

// Rutas funcionales del backend.
app.use('/api/health', healthRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/data', dataRoutes);
app.use('/api', catalogRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/users', auditMutations(auditResolver), userRoutes);
app.use('/api/companies', auditMutations(auditResolver), companyRoutes);
// alertaRoutes maneja /alertas, /eventos y /resumen. Audit acotado a las
// rutas alertas/eventos para no auditar otras rutas /api/*.
app.use('/api/alertas', auditMutations(auditResolver));
app.use('/api/eventos', auditMutations(auditResolver));
app.use('/api', alertaRoutes);

app.use('/api/cold-room', coldRoomRoutes);
app.use('/api/2fa', twoFactorRoutes);

app.use('/api/incidencias', auditMutations(auditResolver), incidenciaRoutes);
app.use('/api/documentos', auditMutations(auditResolver), documentoRoutes);
app.use('/api/audit-log', auditLogRoutes);

// /api/v2/* — router TS compilado. Endpoints nuevos con envelopes estándar,
// caché Redis online, Prometheus metrics, healthcheck liveness/readiness.
try {
  const v2RoutesPath = require('path').join(__dirname, '..', 'dist', 'http', 'v2', 'routes');
  const v2Router = require(v2RoutesPath).default;
  app.use('/api/v2', v2Router);
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') {
    console.warn('[main-api] No se pudo montar /api/v2:', err.message);
  }
}

// Ultimo middleware: normaliza errores de cualquier ruta anterior.
app.use(errorMiddleware);

module.exports = app;
