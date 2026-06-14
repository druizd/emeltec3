/**
 * Rutas para consultar estadisticas internas de uso de la API.
 */
const express = require('express');
const router = express.Router();
const { getMetrics, getMetricsByVariable } = require('../controllers/metricsController');
const { protect } = require('../middlewares/authMiddleware');

// Estadísticas internas de uso: requieren autenticación (EMT-C03).
router.get('/', protect, getMetrics);
router.get('/by-variable', protect, getMetricsByVariable);

module.exports = router;
