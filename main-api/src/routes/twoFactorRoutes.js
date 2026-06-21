const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requestCode } = require('../shared/stepUp2fa');

// POST /api/2fa/request — envía un código 2FA al email del usuario autenticado.
// Luego el cliente reintenta la acción destructiva con header X-2FA-Code.
router.post('/request', protect, async (req, res) => {
  try {
    await requestCode(req.user);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
