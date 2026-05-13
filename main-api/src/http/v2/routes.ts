/**
 * Router HTTP v2. Se monta bajo /api/v2 desde app.js (o app.ts cuando exista).
 */
import { Router } from 'express';
import { protect } from '../../middlewares/auth';
import {
  getHistoryHandler,
  getKeysHandler,
  getLatestHandler,
  getOnlineHandler,
  getPresetHandler,
} from '../../modules/telemetry/controller';
import {
  getDashboardDataHandler,
  getDashboardHistoryHandler,
} from '../../modules/sites/controller';
import { getHierarchyTreeHandler } from '../../modules/companies/controller';
import { loginHandler, requestCodeHandler } from '../../modules/auth/controller';
import { httpMetricsMiddleware } from '../../middlewares/httpMetrics';
import { liveness, prometheusMetrics, readiness } from '../../modules/health/controller';
import {
  createDgaUserHandler,
  exportDatoDgaCsvHandler,
  exportDgaDirectoCsvHandler,
  listDgaUsersHandler,
  queryDatoDgaHandler,
} from '../../modules/dga/controller';

const router = Router();

router.use(httpMetricsMiddleware);

router.get('/health/live', liveness);
router.get('/health/ready', readiness);
router.get('/metrics', prometheusMetrics);

// Telemetría — abierto en v1 (paridad). Si se requiere auth se añade aquí.
router.get('/telemetry', getHistoryHandler);
router.get('/telemetry/latest', getLatestHandler);
router.get('/telemetry/online', getOnlineHandler);
router.get('/telemetry/preset', getPresetHandler);
router.get('/telemetry/keys', getKeysHandler);

// Sitios y companies — requieren JWT.
router.get('/sites/:siteId/dashboard-data', protect, getDashboardDataHandler);
router.get('/sites/:siteId/dashboard-history', protect, getDashboardHistoryHandler);
router.get('/companies/tree', protect, getHierarchyTreeHandler);

router.post('/auth/login', loginHandler);
router.post('/auth/request-code', requestCodeHandler);

// DGA — informantes + consulta de mediciones snapshot + descarga directa.
router.post('/dga/users', protect, createDgaUserHandler);
router.get('/dga/users/:siteId', protect, listDgaUsersHandler);
router.get('/dga/dato', protect, queryDatoDgaHandler);
router.get('/dga/dato/export.csv', protect, exportDatoDgaCsvHandler);
// Descarga manual directa desde `equipo` (sin requerir informante).
router.get('/dga/export-directo.csv', protect, exportDgaDirectoCsvHandler);

export default router;
