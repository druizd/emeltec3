const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const c = require('../controllers/alertaController');

const adminRoles = ['SuperAdmin', 'Admin'];

router.post('/alertas', protect, c.crearAlerta);
router.get('/alertas', protect, c.listarAlertas);
router.get('/alertas/:id', protect, c.obtenerAlerta);
router.put('/alertas/:id', protect, c.actualizarAlerta);
router.delete('/alertas/:id', protect, c.eliminarAlerta);

router.get('/eventos', protect, c.listarEventos);
router.get('/eventos/:id', protect, c.obtenerEvento);
router.put('/eventos/:id/leer', protect, c.marcarLeido);
router.put('/eventos/:id/resolver', protect, authorizeRoles(...adminRoles), c.resolverEvento);

router.get('/resumen', protect, c.resumen);

module.exports = router;
