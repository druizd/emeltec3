const express = require('express');
const router = express.Router();
const { sendOtpEmail } = require('../controllers/internalController');
const { requireEnv } = require('../config/requireEnv');

const INTERNAL_KEY = requireEnv('INTERNAL_API_KEY');

// Sólo acepta llamadas de servicios internos que presenten la clave compartida.
function internalAuth(req, res, next) {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  next();
}

router.post('/email/otp', internalAuth, sendOtpEmail);

module.exports = router;
