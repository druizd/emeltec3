const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { protect } = require('../middlewares/authMiddleware');

// Todas las rutas de companies requieren autenticación
router.use(protect);

router.get('/', companyController.getAllCompanies);
router.get('/tree', companyController.getHierarchyTree);
router.get('/:id/sites', companyController.getCompanySites);

module.exports = router;
