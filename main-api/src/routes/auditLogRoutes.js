const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const c = require('../controllers/auditLogController');

// audit_log es solo lectura — la escritura ocurre vía middleware auditMutations.
router.get('/', protect, c.listarAuditLog);

module.exports = router;
