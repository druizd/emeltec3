const express    = require('express');
const router     = express.Router();
const { sendOtpEmail } = require('../controllers/internalController');

const INTERNAL_KEY = process.env.INTERNAL_API_KEY || '';

// Sólo acepta llamadas de servicios internos que presenten la clave compartida.
// Si no hay clave configurada (dev), se permite sin restricción.
function internalAuth(req, res, next) {
  if (!INTERNAL_KEY) return next();
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  next();
}

router.post('/email/otp', internalAuth, sendOtpEmail);

module.exports = router;
