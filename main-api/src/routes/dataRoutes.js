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

router.post('/', protect, insertData);
router.get('/', protect, getData);
router.get('/latest', protect, getLatest);
router.get('/online', protect, getOnlineValues);
router.get('/range', protect, getByRange);
router.get('/preset', protect, getByPreset);
router.get('/keys', protect, getAvailableKeys);

module.exports = router;
