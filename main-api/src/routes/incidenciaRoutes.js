const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const c = require('../controllers/incidenciaController');

router.get('/', protect, c.listarIncidencias);
router.get('/:id', protect, c.obtenerIncidencia);
router.post('/', protect, c.crearIncidencia);
router.put('/:id', protect, c.actualizarIncidencia);
router.delete('/:id', protect, c.eliminarIncidencia);

module.exports = router;
