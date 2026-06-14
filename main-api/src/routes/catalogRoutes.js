/**
 * Rutas del catalogo: dominios y dispositivos.
 */
const express = require('express');
const router = express.Router();
const { getDomains, getDevices, createDevice } = require('../controllers/catalogController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

// Catálogo: requiere autenticación. La escritura (alta/upsert de equipos)
// queda restringida a roles administrativos (EMT-C03).
router.get('/domains', protect, getDomains);
router.get('/devices', protect, getDevices);
router.post('/devices', protect, authorizeRoles('SuperAdmin', 'Admin'), createDevice);

module.exports = router;
