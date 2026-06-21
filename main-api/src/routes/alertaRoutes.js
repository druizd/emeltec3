const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middlewares/authMiddleware');
const { require2fa } = require('../shared/stepUp2fa');
const c = require('../controllers/alertaController');

const adminRoles = ['SuperAdmin', 'Admin'];
// Alarmas: editar (crear/modificar/borrar) solo Admin/Gerente (+ SuperAdmin).
// El resto de roles solo puede verlas (según visibilidad).
const alarmEditorRoles = ['SuperAdmin', 'Admin', 'Gerente'];

router.post('/alertas', protect, authorizeRoles(...alarmEditorRoles), c.crearAlerta);
router.get('/alertas', protect, c.listarAlertas);
router.get('/alertas/:id', protect, c.obtenerAlerta);
router.put('/alertas/:id', protect, authorizeRoles(...alarmEditorRoles), c.actualizarAlerta);
router.delete(
  '/alertas/:id',
  protect,
  authorizeRoles(...alarmEditorRoles),
  require2fa,
  c.eliminarAlerta,
);

router.get('/eventos', protect, c.listarEventos);
router.get('/eventos/:id', protect, c.obtenerEvento);
router.put('/eventos/:id/leer', protect, c.marcarLeido);
router.put('/eventos/:id/reconocer', protect, c.reconocerEvento);
router.put('/eventos/:id/asignar', protect, c.asignarEvento);
router.put('/eventos/:id/incidencia', protect, c.vincularIncidencia);
router.put('/eventos/:id/resolver', protect, authorizeRoles(...adminRoles), c.resolverEvento);

router.get('/resumen', protect, c.resumen);

module.exports = router;
