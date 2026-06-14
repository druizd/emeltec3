const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/authRoutes');
const healthRoutes = require('./routes/healthRoutes');
const errorMiddleware = require('./middlewares/errorMiddleware');

const app = express();

// Detrás de reverse proxy (nginx). Para que req.ip sea el origen real (Ley 21.663
// requiere bitácora con IP del actor) habilitamos confianza solo en 1 hop.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
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
