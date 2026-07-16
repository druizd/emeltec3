const express = require('express');
const path = require('path');
const router = express.Router();
const companyController = require('../controllers/companyController');
const pasteurizadorController = require('../controllers/pasteurizadorController');
const incidenciaController = require('../controllers/incidenciaController');
const { protect } = require('../middlewares/authMiddleware');
const { requireSiteAccess } = require('../middlewares/coldRoomAccess');

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

let siteOperacionConfigController = null;
try {
  siteOperacionConfigController = require(
    path.join(__dirname, '..', '..', 'dist', 'modules', 'siteOperacionConfig', 'controller'),
  );
} catch (err) {
  if (err && err.code !== 'MODULE_NOT_FOUND') {
    console.warn('[companyRoutes] No se pudo cargar siteOperacionConfig controller:', err.message);
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
router.get('/contacts', companyController.listOperationalContacts);
router.post('/contacts', companyController.createOperationalContact);
router.delete('/contacts/:contactId', companyController.deleteOperationalContact);

router.post('/:companyId/sub-companies', companyController.createSubCompany);
router.patch('/:companyId/sub-companies/:subCompanyId', companyController.updateSubCompany);
router.delete('/:companyId/sub-companies/:subCompanyId', companyController.deleteSubCompany);
router.post('/:companyId/sub-companies/:subCompanyId/sites', companyController.createSite);
router.patch('/sites/:siteId', companyController.updateSite);
router.delete('/sites/:siteId', companyController.deleteSite);
router.get('/sites/:siteId/pozo-config', companyController.getSitePozoConfig);
router.get('/sites/:siteId/dashboard-data', companyController.getSiteDashboardData);
// requireSiteAccess('siteId') cierra el IDOR: estos handlers TS leían/escribían
// por siteId sin verificar que el sitio pertenezca al usuario.
if (contadoresController) {
  router.get(
    '/sites/:siteId/contadores-mensuales',
    requireSiteAccess('siteId'),
    contadoresController.getMonthlySeriesHandler,
  );
  router.get(
    '/sites/:siteId/contadores-diarios',
    requireSiteAccess('siteId'),
    contadoresController.getDailySeriesHandler,
  );
  router.get(
    '/sites/:siteId/contadores-jornadas',
    requireSiteAccess('siteId'),
    contadoresController.getJornadaSeriesHandler,
  );
}
if (siteOperacionConfigController) {
  router.get(
    '/sites/:siteId/operacion-config',
    requireSiteAccess('siteId'),
    siteOperacionConfigController.getSiteOperacionConfigHandler,
  );
  router.put(
    '/sites/:siteId/operacion-config',
    requireSiteAccess('siteId'),
    siteOperacionConfigController.updateSiteOperacionConfigHandler,
  );
}
router.get('/sites/:siteId/dashboard-history/export', companyController.exportSiteDashboardHistory);
router.get('/sites/:siteId/dashboard-history', companyController.getSiteDashboardHistory);
router.get('/sites/:siteId/operacion-bundle', companyController.getSiteOperacionBundle);
router.get(
  '/sites/:siteId/pasteurizador/snapshot',
  pasteurizadorController.getPasteurizadorSnapshot,
);
router.get('/sites/:siteId/pasteurizador/bundle', pasteurizadorController.getPasteurizadorBundle);
router.get('/sites/:siteId/pasteurizador/history', pasteurizadorController.getPasteurizadorHistory);
router.get(
  '/sites/:siteId/pasteurizador/daily-kpis',
  pasteurizadorController.getPasteurizadorDailyKpis,
);
router.get('/sites/:siteId/pasteurizador/summary', pasteurizadorController.getPasteurizadorSummary);
router.get('/sites/:siteId/period-aggregates', companyController.getSitePeriodAggregates);
router.get(
  '/sites/:siteId/period-aggregates-daily',
  companyController.getSitePeriodAggregatesDaily,
);
router.get('/sites/:siteId/variables', companyController.getSiteVariables);
router.post('/sites/:siteId/variables', companyController.createSiteVariableMap);
router.patch('/sites/:siteId/variables/:mapId', companyController.updateSiteVariableMap);
router.delete('/sites/:siteId/variables/:mapId', companyController.deleteSiteVariableMap);

router.get('/:id/sites', companyController.getCompanySites);

// ── Incidencias por sitio ────────────────────────────────────────────────────
// Proxy al controller de incidencias que ya soporta filtro por sitio_id.
// requireSiteAccess('siteId') garantiza que el usuario tiene acceso al sitio
// antes de delegar al controller (que aplica adicionalmente los filtros por empresa).
// Query params soportados: desde, hasta, estado, categoria, gravedad, page, limit.
router.get(
  '/sites/:siteId/incidencias',
  requireSiteAccess('siteId'),
  (req, res, next) => {
    // Inyecta el siteId del path como query param para que listarIncidencias lo filtre.
    req.query.sitio_id = req.params.siteId;
    incidenciaController.listarIncidencias(req, res, next);
  },
);

module.exports = router;
