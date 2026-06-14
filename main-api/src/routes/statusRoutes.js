const express = require('express');
const router = express.Router();
const { getStatus, getStatusDetail } = require('../controllers/statusController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

// Público: solo el estado por servicio (sin detalle interno — EMT-C03/M08).
router.get('/', getStatus);

// Autenticado: detalle operativo (latencia, uptime, entorno) para operadores.
router.get('/detail', protect, authorizeRoles('SuperAdmin', 'Admin'), getStatusDetail);

module.exports = router;
