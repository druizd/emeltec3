/**
 * Rutas del catalogo: dominios y dispositivos.
 */
const express = require('express');
const router = express.Router();
const { getDomains, getDevices, createDevice } = require('../controllers/catalogController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

router.get('/domains', protect, getDomains);
router.get('/devices', protect, getDevices);
router.post('/devices', protect, authorizeRoles('SuperAdmin'), createDevice);

module.exports = router;
