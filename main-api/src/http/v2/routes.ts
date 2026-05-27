/**
 * Router HTTP v2. Se monta bajo /api/v2 desde app.js (o app.ts cuando exista).
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authorizeRoles, protect } from '../../middlewares/auth';
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
  deleteInformanteHandler,
  exportDatoDgaCsvHandler,
  exportDgaDirectoCsvHandler,
  getDgaLivePreviewHandler,
  getPozoDgaConfigHandler,
  getUltimoEnvioHandler,
  listInformantesHandler,
  listReviewQueueHandler,
  patchPozoDgaConfigHandler,
  queryDatoDgaHandler,
  request2faCodeHandler,
  reviewSlotActionHandler,
  upsertInformanteHandler,
} from '../../modules/dga/controller';
import { requireDgaTwoFactor } from '../../modules/dga/twofactor';

// auditLog es CJS legacy: bitácora append-only para mutaciones (Ley 21.663 §32).
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

const auditBitacoraMutations = auditMutations((req) => {
  const path = req.path;
  // PATCH /sites/:siteId/bitacora/ficha
  const fichaMatch = /^\/sites\/([^/]+)\/bitacora\/ficha$/.exec(path);
  if (req.method === 'PATCH' && fichaMatch) {
    return { action: 'bitacora.ficha.patch', targetType: 'ficha', targetId: fichaMatch[1] ?? '' };
  }
  // PATCH /sites/bitacora/equipos/:id
  const equipoPatchMatch = /^\/sites\/bitacora\/equipos\/([^/]+)$/.exec(path);
  if (req.method === 'PATCH' && equipoPatchMatch) {
    return {
      action: 'bitacora.equipo.patch',
      targetType: 'sitio_equipo',
      targetId: equipoPatchMatch[1] ?? '',
    };
  }
  // DELETE /sites/bitacora/equipos/:id
  if (req.method === 'DELETE' && equipoPatchMatch) {
    return {
      action: 'bitacora.equipo.delete',
      targetType: 'sitio_equipo',
      targetId: equipoPatchMatch[1] ?? '',
    };
  }
  return { action: `bitacora.${req.method.toLowerCase()}.unknown` };
});

const auditDgaMutations = auditMutations((req) => {
  const path = req.path;
  // PATCH /dga/sites/:siteId/pozo-config
  const pozoMatch = /^\/dga\/sites\/([^/]+)\/pozo-config$/.exec(path);
  if (req.method === 'PATCH' && pozoMatch) {
    return {
      action: 'dga.pozo_config.patch',
      targetType: 'pozo_config',
      targetId: pozoMatch[1] ?? '',
    };
  }
  // POST /dga/informantes (create)
  if (req.method === 'POST' && path === '/dga/informantes') {
    return {
      action: 'dga.informante.upsert',
      targetType: 'dga_informante',
      targetId: String(req.body?.rut ?? ''),
    };
  }
  // PATCH /dga/informantes/:rut
  const infMatch = /^\/dga\/informantes\/([^/]+)$/.exec(path);
  if (req.method === 'PATCH' && infMatch) {
    return {
      action: 'dga.informante.upsert',
      targetType: 'dga_informante',
      targetId: infMatch[1] ?? '',
    };
  }
  if (req.method === 'DELETE' && infMatch) {
    return {
      action: 'dga.informante.delete',
      targetType: 'dga_informante',
      targetId: infMatch[1] ?? '',
    };
  }
  if (req.method === 'POST' && path === '/dga/2fa/request') {
    return { action: 'dga.2fa.request' };
  }
  if (req.method === 'POST' && path === '/dga/review-queue/action') {
    return {
      action: `dga.review.${req.body?.action ?? 'unknown'}`,
      targetType: 'dato_dga',
      targetId: `${req.body?.site_id ?? ''}::${req.body?.ts ?? ''}`,
    };
  }
  return { action: `dga.${req.method.toLowerCase()}.unknown` };
});

/**
 * Middleware: exige 2FA solo si el body de PATCH pozo-config intenta cambiar
 * dga_transport a 'rest'. Otros cambios (activo, caudal_max, etc.) no
 * requieren 2FA — pasan derecho al handler.
 */
function require2faIfTransportRest(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (req.body?.dga_transport === 'rest') {
    return requireDgaTwoFactor(req, res, next);
  }
  next();
}

/**
 * Middleware: 2FA siempre para rotación de clave de informante.
 */
function require2faIfPasswordChange(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (typeof req.body?.clave_informante === 'string' && req.body.clave_informante.length > 0) {
    return requireDgaTwoFactor(req, res, next);
  }
  next();
}

const router = Router();

router.use(httpMetricsMiddleware);

router.get('/health/live', liveness);
router.get('/health/ready', readiness);
router.get('/metrics', prometheusMetrics);

router.get('/telemetry', protect, getHistoryHandler);
router.get('/telemetry/latest', protect, getLatestHandler);
router.get('/telemetry/online', protect, getOnlineHandler);
router.get('/telemetry/preset', protect, getPresetHandler);
router.get('/telemetry/keys', protect, getKeysHandler);

router.get('/sites/:siteId/dashboard-data', protect, getDashboardDataHandler);
router.get('/sites/:siteId/dashboard-history', protect, getDashboardHistoryHandler);
router.get('/companies/tree', protect, getHierarchyTreeHandler);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' },
});

router.post('/auth/login', authLimiter, loginHandler);
router.post('/auth/request-code', authLimiter, requestCodeHandler);

// =====================================================================
// DGA — modelo redesign 2026-05-17.
// =====================================================================

// Informantes (pool global). Solo Admin/SuperAdmin. Rotación de clave exige 2FA.
router.get('/dga/informantes', protect, authorizeRoles('SuperAdmin', 'Admin'), listInformantesHandler);
router.post(
  '/dga/informantes',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  require2faIfPasswordChange,
  auditDgaMutations,
  upsertInformanteHandler,
);
router.patch(
  '/dga/informantes/:rut',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  require2faIfPasswordChange,
  auditDgaMutations,
  upsertInformanteHandler,
);
router.delete(
  '/dga/informantes/:rut',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  requireDgaTwoFactor,
  auditDgaMutations,
  deleteInformanteHandler,
);

// Config DGA por pozo. Activar transport=rest exige 2FA.
router.get('/dga/sites/:siteId/pozo-config', protect, getPozoDgaConfigHandler);
router.patch(
  '/dga/sites/:siteId/pozo-config',
  protect,
  require2faIfTransportRest,
  auditDgaMutations,
  patchPozoDgaConfigHandler,
);
router.get('/dga/sites/:siteId/live-preview', protect, getDgaLivePreviewHandler);
router.get('/dga/sites/:siteId/ultimo-envio', protect, getUltimoEnvioHandler);

// =====================================================================
// Bitácora del sitio: ficha + equipamiento.
// =====================================================================
import {
  createEquipoHandler,
  deleteEquipoHandler,
  getFichaHandler,
  listEquiposHandler,
  patchEquipoHandler,
  patchFichaHandler,
} from '../../modules/bitacoraSitio/controller';

// Análisis del sitio (salud, métricas).
import { getMetricasHandler, getSaludHandler } from '../../modules/analisis/controller';

router.get('/sites/:siteId/analisis/salud', protect, getSaludHandler);
router.get('/sites/:siteId/analisis/metricas', protect, getMetricasHandler);

router.get('/sites/:siteId/bitacora/ficha', protect, getFichaHandler);
router.patch('/sites/:siteId/bitacora/ficha', protect, auditBitacoraMutations, patchFichaHandler);
router.get('/sites/:siteId/bitacora/equipos', protect, listEquiposHandler);
router.post('/sites/:siteId/bitacora/equipos', protect, createEquipoHandler);
router.patch('/sites/bitacora/equipos/:id', protect, auditBitacoraMutations, patchEquipoHandler);
router.delete('/sites/bitacora/equipos/:id', protect, auditBitacoraMutations, deleteEquipoHandler);

// Mediciones (Detalle de Registros + CSV)
router.get('/dga/dato', protect, queryDatoDgaHandler);
router.get('/dga/dato/export.csv', protect, exportDatoDgaCsvHandler);
router.get('/dga/export-directo.csv', protect, exportDgaDirectoCsvHandler);

// 2FA email-OTP — el código se manda al MONITOR_PRIMARY_EMAIL.
router.post('/dga/2fa/request', protect, auditDgaMutations, request2faCodeHandler);

// Review queue (acceso para Admin/SuperAdmin solo).
router.get('/dga/review-queue', protect, authorizeRoles('SuperAdmin', 'Admin'), listReviewQueueHandler);
router.post(
  '/dga/review-queue/action',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  requireDgaTwoFactor,
  auditDgaMutations,
  reviewSlotActionHandler,
);

export default router;
