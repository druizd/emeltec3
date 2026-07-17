const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/authRoutes');
const healthRoutes = require('./routes/healthRoutes');
const errorMiddleware = require('./middlewares/errorMiddleware');

const app = express();

// Detrás del nginx de borde de la VM (proxy directo a 127.0.0.1:3001 — ver
// EMT-H03 en docker-compose). Para que req.ip sea la IP real del cliente
// (Ley 21.663 exige bitácora con IP del actor) el borde DEBE enviar
// `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` — sin ese
// header req.ip cae a la IP del propio borde (bug detectado 17-07-2026).
// Hops ajustables por env si la topología cambia.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

app.use(helmet());

// CORS: solo subdominios de emeltec.cl (https) y desarrollo local (localhost /
// 127.0.0.1). Sin Origin (server-to-server / curl) se permite. Antes era abierto.
function isAllowedOrigin(origin) {
  if (!origin) return true;
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
app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)) }));
app.use(express.json({ limit: '10kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate-limit global del namespace /api/auth (defensa en profundidad).
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos. Espera 1 minuto.' },
});

// Rate-limit estricto solicitud de OTP — defiende anti-enumeración + spray.
// Complementa al límite per-email persistido en usuario.otp_requests_count.
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes de codigo. Espera 1 minuto.' },
});

// Rate-limit estricto login — defiende contra brute-force distribuido por IP.
// El lockout per-account (5 fallos -> 1min) opera en authController.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos de login. Espera 1 minuto.' },
});

// Rate-limit estricto en /start — encarece la enumeración de cuentas (el flow
// revela estado/método) y el spray de OTP. Default 10/min/IP; configurable por
// env para despliegues detrás de NAT compartido (oficinas con muchos usuarios
// por IP) sin tener que tocar código.
const startLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.START_RATE_LIMIT_MAX || '10', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos. Espera 1 minuto.' },
});

app.use('/api/health', healthRoutes);
app.use('/api/auth/request-code', otpRequestLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/start', startLimiter);
app.use('/api/auth', authLimiter, authRoutes);

app.use(errorMiddleware);

module.exports = app;
