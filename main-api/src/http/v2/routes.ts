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
  listReviewQueueHandler,
  patchDgaUserConfigHandler,
  queryDatoDgaHandler,
  request2faCodeHandler,
  reviewSlotActionHandler,
} from '../../modules/dga/controller';
import { requireDgaTwoFactor } from '../../modules/dga/twofactor';
import { authorizeRoles } from '../../middlewares/auth';

// auditLog es CJS legacy: bitácora append-only para mutaciones (Ley 21.663 §32).
// Aplicamos a los endpoints DGA que mutan estado o ejecutan acciones admin.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditMutations } = require('../../services/auditLog') as {
  auditMutations: (
    resolver: (req: import('express').Request) => {
      action: string;
      targetType?: string;
      targetId?: string;
    },
  ) => import('express').RequestHandler;
};

const auditDgaMutations = auditMutations((req) => {
  const path = req.path;
  // PATCH /dga/users/:id/config
  if (req.method === 'PATCH' && /^\/dga\/users\/\d+\/config$/.test(path)) {
    return {
      action: 'dga.user.config.patch',
      targetType: 'dga_user',
      targetId: String(req.params.id ?? ''),
    };
  }
  // POST /dga/users
  if (req.method === 'POST' && path === '/dga/users') {
    return {
      action: 'dga.user.create',
      targetType: 'dga_user',
      targetId: String(req.body?.site_id ?? ''),
    };
  }
  // POST /dga/2fa/request
  if (req.method === 'POST' && path === '/dga/2fa/request') {
    return { action: 'dga.2fa.request' };
  }
  // POST /dga/review-queue/action
  if (req.method === 'POST' && path === '/dga/review-queue/action') {
    return {
      action: `dga.review.${req.body?.action ?? 'unknown'}`,
      targetType: 'dato_dga',
      targetId: `${req.body?.id_dgauser ?? ''}::${req.body?.ts ?? ''}`,
    };
  }
  return { action: `dga.${req.method.toLowerCase()}.unknown` };
});

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
router.post('/dga/users', protect, auditDgaMutations, createDgaUserHandler);
router.patch(
  '/dga/users/:id/config',
  protect,
  auditDgaMutations,
  patchDgaUserConfigHandler,
);
router.get('/dga/users/:siteId', protect, listDgaUsersHandler);
router.get('/dga/dato', protect, queryDatoDgaHandler);

// DGA admin: review queue + 2FA email-OTP.
// Solo SuperAdmin/Admin pueden actuar; el código se manda al MONITOR_PRIMARY_EMAIL.
router.post(
  '/dga/2fa/request',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  auditDgaMutations,
  request2faCodeHandler,
);
router.get(
  '/dga/review-queue',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  listReviewQueueHandler,
);
router.post(
  '/dga/review-queue/action',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  requireDgaTwoFactor,
  auditDgaMutations,
  reviewSlotActionHandler,
);
router.get('/dga/dato/export.csv', protect, exportDatoDgaCsvHandler);
// Descarga manual directa desde `equipo` (sin requerir informante).
router.get('/dga/export-directo.csv', protect, exportDgaDirectoCsvHandler);

export default router;
