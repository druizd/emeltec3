/**
 * Rutas para consultar estadisticas internas de uso de la API.
 */
const express = require('express');
const router = express.Router();
const { getMetrics, getMetricsByVariable } = require('../controllers/metricsController');
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');

router.get('/', protect, authorizeRoles('SuperAdmin', 'Admin'), getMetrics);
router.get('/by-variable', protect, authorizeRoles('SuperAdmin', 'Admin'), getMetricsByVariable);

module.exports = router;
