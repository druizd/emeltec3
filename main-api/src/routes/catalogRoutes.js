/**
 * Rutas del catalogo: dominios y dispositivos.
 */
const express = require('express');
const router = express.Router();
const { getDomains, getDevices, createDevice } = require('../controllers/catalogController');

router.get('/domains', getDomains);
router.get('/devices', getDevices);
router.post('/devices', createDevice);

module.exports = router;
