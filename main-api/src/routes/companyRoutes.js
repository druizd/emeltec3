const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { protect } = require('../middlewares/authMiddleware');

// Todas las rutas de companies requieren autenticación
router.use(protect);

router.get('/', companyController.getAllCompanies);
router.post('/', companyController.createCompany);
router.patch('/:companyId', companyController.updateCompany);
router.delete('/:companyId', companyController.deleteCompany);
router.get('/tree', companyController.getHierarchyTree);
router.get('/detected-devices', companyController.getDetectedDevices);
router.get('/site-type-catalog', companyController.getSiteTypeCatalog);

router.post('/:companyId/sub-companies', companyController.createSubCompany);
router.patch('/:companyId/sub-companies/:subCompanyId', companyController.updateSubCompany);
router.delete('/:companyId/sub-companies/:subCompanyId', companyController.deleteSubCompany);
router.post('/:companyId/sub-companies/:subCompanyId/sites', companyController.createSite);
router.patch('/sites/:siteId', companyController.updateSite);
router.delete('/sites/:siteId', companyController.deleteSite);
router.get('/sites/:siteId/dashboard-data', companyController.getSiteDashboardData);
router.get('/sites/:siteId/dashboard-history/export', companyController.exportSiteDashboardHistory);
router.get('/sites/:siteId/dashboard-history', companyController.getSiteDashboardHistory);
router.get('/sites/:siteId/variables', companyController.getSiteVariables);
router.post('/sites/:siteId/variables', companyController.createSiteVariableMap);
router.patch('/sites/:siteId/variables/:mapId', companyController.updateSiteVariableMap);
router.delete('/sites/:siteId/variables/:mapId', companyController.deleteSiteVariableMap);

router.get('/:id/sites', companyController.getCompanySites);

module.exports = router;
