/**
 * Rutas de consulta simplificada sobre datos historicos y ultimo registro.
 */
const express = require('express');
const router = express.Router();

const {
  insertData,
  getData,
  getLatest,
  getByRange,
  getByPreset,
  getAvailableKeys,
  getOnlineValues,
} = require('../controllers/dataController');
const { protect } = require('../middlewares/authMiddleware');
const { requireDataSerialAccess } = require('../middlewares/dataSerialAccess');

// Toda lectura de datos pasa por requireDataSerialAccess: autoriza el serial
// pedido contra el alcance del usuario y deja el serial resuelto en req.dataSerial.
router.post('/', protect, insertData);
router.get('/', protect, requireDataSerialAccess, getData);
router.get('/latest', protect, requireDataSerialAccess, getLatest);
router.get('/online', protect, requireDataSerialAccess, getOnlineValues);
router.get('/range', protect, requireDataSerialAccess, getByRange);
router.get('/preset', protect, requireDataSerialAccess, getByPreset);
router.get('/keys', protect, requireDataSerialAccess, getAvailableKeys);

module.exports = router;
