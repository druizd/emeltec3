const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { sendOtpEmail } = require('../controllers/internalController');
const { requireEnv } = require('../config/requireEnv');

const INTERNAL_KEY_BUF = Buffer.from(requireEnv('INTERNAL_API_KEY'), 'utf8');

// Comparación constant-time previene timing-attacks sobre la clave compartida.
function internalAuth(req, res, next) {
  const presented = Buffer.from((req.headers['x-internal-key'] || '').toString(), 'utf8');
  if (presented.length !== INTERNAL_KEY_BUF.length) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  if (!crypto.timingSafeEqual(presented, INTERNAL_KEY_BUF)) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  next();
}

router.post('/email/otp', internalAuth, sendOtpEmail);

module.exports = router;
