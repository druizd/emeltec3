const express = require('express');
const path = require('path');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { protect } = require('../middlewares/authMiddleware');

// Lazy require del controller TS compilado de contadores (puede no estar
// disponible en dev sin build). Se monta solo si carga.
let contadoresController = null;
try {
  contadoresController = require(
    path.join(__dirname, '..', '..', 'dist', 'modules', 'contadores', 'controller'),
  );
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') {
    console.warn('[companyRoutes] No se pudo cargar contadores controller:', err.message);
  }
}

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
if (contadoresController) {
  router.get('/sites/:siteId/contadores-mensuales', contadoresController.getMonthlySeriesHandler);
  router.get('/sites/:siteId/contadores-diarios', contadoresController.getDailySeriesHandler);
}
router.get('/sites/:siteId/dashboard-history/export', companyController.exportSiteDashboardHistory);
router.get('/sites/:siteId/dashboard-history', companyController.getSiteDashboardHistory);
router.get('/sites/:siteId/variables', companyController.getSiteVariables);
router.post('/sites/:siteId/variables', companyController.createSiteVariableMap);
router.patch('/sites/:siteId/variables/:mapId', companyController.updateSiteVariableMap);
router.delete('/sites/:siteId/variables/:mapId', companyController.deleteSiteVariableMap);

router.get('/:id/sites', companyController.getCompanySites);

module.exports = router;
