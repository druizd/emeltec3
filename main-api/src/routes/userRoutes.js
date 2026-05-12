const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');

// Todas las rutas de usuarios requieren autenticación
router.use(authMiddleware.protect);

// Endpoint para traer las empresas disponibles (filtradas por rol del usuario actual)
router.get('/empresas', userController.getEmpresas);

// Listar usuarios (filtrado por rol en el controller)
router.get('/', userController.getAllUsers);

// Crear usuarios (Solo Admin, SuperAdmin y Gerente)
router.post(
  '/',
  authMiddleware.authorizeRoles('Admin', 'SuperAdmin', 'Gerente'),
  userController.createUser,
);

// Eliminar usuarios (Solo Admin, SuperAdmin y Gerente)
router.delete(
  '/:id',
  authMiddleware.authorizeRoles('Admin', 'SuperAdmin', 'Gerente'),
  userController.deleteUser,
);

module.exports = router;
