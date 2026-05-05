const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { protect } = require('../middlewares/authMiddleware');

// Todas las rutas de companies requieren autenticación
router.use(protect);

router.get('/', companyController.getAllCompanies);
router.post('/', companyController.createCompany);
router.get('/tree', companyController.getHierarchyTree);
router.get('/detected-devices', companyController.getDetectedDevices);

router.post('/:companyId/sub-companies', companyController.createSubCompany);
router.post('/:companyId/sub-companies/:subCompanyId/sites', companyController.createSite);
router.patch('/sites/:siteId', companyController.updateSite);
router.get('/sites/:siteId/variables', companyController.getSiteVariables);
router.post('/sites/:siteId/variables', companyController.createSiteVariableMap);
router.patch('/sites/:siteId/variables/:mapId', companyController.updateSiteVariableMap);
router.delete('/sites/:siteId/variables/:mapId', companyController.deleteSiteVariableMap);

router.get('/:id/sites', companyController.getCompanySites);

module.exports = router;
