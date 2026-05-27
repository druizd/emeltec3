/**
 * Rutas para consultar estadisticas internas de uso de la API.
 */
const express = require('express');
const router = express.Router();
const { getMetrics, getMetricsByVariable } = require('../controllers/metricsController');

router.get('/', getMetrics);
router.get('/by-variable', getMetricsByVariable);

module.exports = router;
