const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');
const { require2fa } = require('../shared/stepUp2fa');

// Todas las rutas de usuarios requieren autenticación
router.use(authMiddleware.protect);

// Endpoint para traer las empresas disponibles (filtradas por rol del usuario actual)
router.get('/empresas', userController.getEmpresas);

// Técnicos asignables a incidencias (equipo Emeltec = SuperAdmin activos).
// Cliente no accede; Admin/Gerente sí (asignan técnico al crear incidencia).
router.get('/tecnicos', userController.getTecnicos);

// Equipo Emeltec (SuperAdmin + Vendedor) para la sección de administración.
router.get(
  '/equipo-emeltec',
  authMiddleware.authorizeRoles('SuperAdmin'),
  userController.getEquipoEmeltec,
);

// Perfil del usuario autenticado
router.get('/me', userController.getCurrentUser);
router.patch('/me', userController.updateCurrentUser);
router.patch('/me/password', userController.updateCurrentPassword);
router.patch('/me/security', userController.updateCurrentSecurity);

// Listar usuarios (filtrado por rol en el controller)
router.get('/', userController.getAllUsers);

// Crear usuarios (Solo Admin, SuperAdmin y Gerente) — exige 2FA.
router.post(
  '/',
  authMiddleware.authorizeRoles('Admin', 'SuperAdmin', 'Gerente'),
  require2fa,
  userController.createUser,
);

// Editar usuario (Solo Admin, SuperAdmin y Gerente) — exige 2FA.
router.patch(
  '/:id',
  authMiddleware.authorizeRoles('Admin', 'SuperAdmin', 'Gerente'),
  require2fa,
  userController.updateUser,
);

// Reset de contraseña por admin (reenvía código de acceso) — exige 2FA.
router.post(
  '/:id/reset-password',
  authMiddleware.authorizeRoles('Admin', 'SuperAdmin', 'Gerente'),
  require2fa,
  userController.resetUserPassword,
);

// Eliminar (desactivar) usuarios (Solo Admin, SuperAdmin y Gerente) — exige 2FA.
router.delete(
  '/:id',
  authMiddleware.authorizeRoles('Admin', 'SuperAdmin', 'Gerente'),
  require2fa,
  userController.deleteUser,
);

// Supresión ARCO+ (Ley 21.719): anonimiza PII. El titular puede ejecutarlo sobre
// sí mismo; un SuperAdmin puede ejecutarlo sobre cualquier cuenta.
// La lógica de autorización "SuperAdmin O titular" vive en el controller.
// Irreversible — exige 2FA igual que DELETE /:id (el soft-delete reversible).
router.post('/:id/suprimir', require2fa, userController.suprimirUsuario);

module.exports = router;
