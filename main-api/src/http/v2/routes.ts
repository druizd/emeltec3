/**
 * Router HTTP v2. Se monta bajo /api/v2 desde app.js (o app.ts cuando exista).
 */
import { Router } from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { protect, authorizeRoles } from '../../middlewares/auth';
import { requireSiteParamAccess } from '../../middlewares/siteAccess';
import {
  getHistoryHandler,
  getKeysHandler,
  getLatestHandler,
  getOnlineHandler,
  getPresetHandler,
} from '../../modules/telemetry/controller';
import { requireTelemetrySerialAccess } from '../../modules/telemetry/serialAccess';
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
  verifySniaHandler,
  listInformantesHandler,
  listReviewQueueHandler,
  patchPozoDgaConfigHandler,
  queryDatoDgaHandler,
  reconocerSensorDefectuosoHandler,
  reviewSlotActionHandler,
  upsertInformanteHandler,
} from '../../modules/dga/controller';
import { require2fa } from '../../shared/email-otp';
import { require2faIfSensitiveChange } from '../../modules/dga/twofactor-guards';

// auditLog es CJS legacy: bitácora append-only para mutaciones (Ley 21.663 §32).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditMutations } = require('../../services/auditLog') as {
  auditMutations: (
    resolver: (req: Request) => {
      action: string;
      targetType?: string;
      targetId?: string;
    },
  ) => RequestHandler;
};

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
  if (req.method === 'POST' && path === '/dga/review-queue/action') {
    return {
      action: `dga.review.${req.body?.action ?? 'unknown'}`,
      targetType: 'dato_dga',
      targetId: `${req.body?.site_id ?? ''}::${req.body?.ts ?? ''}`,
    };
  }
  const reconMatch = path.match(/^\/dga\/sites\/([^/]+)\/reconocer-sensor-defectuoso$/);
  if (req.method === 'POST' && reconMatch) {
    return {
      action: 'dga.sensor.reconocer_defectuoso',
      targetType: 'sitio',
      targetId: reconMatch[1] ?? '',
    };
  }
  return { action: `dga.${req.method.toLowerCase()}.unknown` };
});

/**
 * Middleware: 2FA siempre para rotación de clave de informante.
 */
function require2faIfPasswordChange(req: Request, res: Response, next: NextFunction): void {
  if (typeof req.body?.clave_informante === 'string' && req.body.clave_informante.length > 0) {
    return require2fa(req, res, next);
  }
  next();
}

const router = Router();

router.use(httpMetricsMiddleware);

router.get('/health/live', liveness);
router.get('/health/ready', readiness);
router.get('/metrics', prometheusMetrics);

// v2 telemetría: antes SIN `protect` → acceso anónimo cross-tenant (crítico).
// Ahora exige autenticación + autorización por serial (mismo modelo que v1).
router.get('/telemetry', protect, requireTelemetrySerialAccess, getHistoryHandler);
router.get('/telemetry/latest', protect, requireTelemetrySerialAccess, getLatestHandler);
router.get('/telemetry/online', protect, requireTelemetrySerialAccess, getOnlineHandler);
router.get('/telemetry/preset', protect, requireTelemetrySerialAccess, getPresetHandler);
router.get('/telemetry/keys', protect, requireTelemetrySerialAccess, getKeysHandler);

router.get('/sites/:siteId/dashboard-data', protect, getDashboardDataHandler);
router.get('/sites/:siteId/dashboard-history', protect, getDashboardHistoryHandler);
router.get('/companies/tree', protect, getHierarchyTreeHandler);

router.post('/auth/login', loginHandler);
router.post('/auth/request-code', requestCodeHandler);

// =====================================================================
// DGA — modelo redesign 2026-05-17.
// =====================================================================

// Informantes = pool GLOBAL de credenciales SNIA (sin columna de tenant).
// Solo SuperAdmin puede gestionarlas; antes cualquier usuario autenticado podía
// listar/rotar/borrar credenciales DGA de otras empresas. Rotación exige 2FA.
router.get('/dga/informantes', protect, authorizeRoles('SuperAdmin'), listInformantesHandler);
router.post(
  '/dga/informantes',
  protect,
  authorizeRoles('SuperAdmin'),
  require2faIfPasswordChange,
  auditDgaMutations,
  upsertInformanteHandler,
);
router.patch(
  '/dga/informantes/:rut',
  protect,
  authorizeRoles('SuperAdmin'),
  require2faIfPasswordChange,
  auditDgaMutations,
  upsertInformanteHandler,
);
router.delete(
  '/dga/informantes/:rut',
  protect,
  authorizeRoles('SuperAdmin'),
  require2fa,
  auditDgaMutations,
  deleteInformanteHandler,
);

// Config DGA por pozo. Activar transport=rest o dga_gcs_export=true exige 2FA.
router.get(
  '/dga/sites/:siteId/pozo-config',
  protect,
  requireSiteParamAccess(),
  getPozoDgaConfigHandler,
);
router.patch(
  '/dga/sites/:siteId/pozo-config',
  protect,
  requireSiteParamAccess(),
  require2faIfSensitiveChange,
  auditDgaMutations,
  patchPozoDgaConfigHandler,
);
router.get(
  '/dga/sites/:siteId/live-preview',
  protect,
  requireSiteParamAccess(),
  getDgaLivePreviewHandler,
);
router.get(
  '/dga/sites/:siteId/ultimo-envio',
  protect,
  requireSiteParamAccess(),
  getUltimoEnvioHandler,
);
router.get('/dga/sites/:siteId/verify', protect, requireSiteParamAccess(), verifySniaHandler);

// =====================================================================
// Bitácora del sitio: ficha + equipamiento.
// =====================================================================
import {
  createContactoHandler,
  createEquipoHandler,
  deleteContactoHandler,
  deleteEquipoHandler,
  getFichaHandler,
  listEquiposHandler,
  patchContactoHandler,
  patchEquipoHandler,
  patchFichaHandler,
  revealContactoHandler,
} from '../../modules/bitacoraSitio/controller';

// Reveal de PII de contactos operativos (agenda). El listado va enmascarado;
// esto revela con 2FA + auditoría, con el mismo scoping por rol.
import { revealOperationalContactHandler } from '../../modules/contactos/controller';

router.post('/companies/contacts/:id/reveal', protect, require2fa, revealOperationalContactHandler);

// Análisis del sitio (salud, métricas).
import { getMetricasHandler, getSaludHandler } from '../../modules/analisis/controller';

router.get('/sites/:siteId/analisis/salud', protect, requireSiteParamAccess(), getSaludHandler);
router.get(
  '/sites/:siteId/analisis/metricas',
  protect,
  requireSiteParamAccess(),
  getMetricasHandler,
);

router.get('/sites/:siteId/bitacora/ficha', protect, requireSiteParamAccess(), getFichaHandler);
router.patch('/sites/:siteId/bitacora/ficha', protect, requireSiteParamAccess(), patchFichaHandler);
// Contactos = contacto_operativo scopeado al sitio. Son PII: el read va
// enmascarado y estas rutas exigen 2FA + auditoría. Direccionados por id estable.
router.post(
  '/sites/:siteId/bitacora/contacto',
  protect,
  requireSiteParamAccess(),
  require2fa,
  createContactoHandler,
);
router.post(
  '/sites/:siteId/bitacora/contacto/:id/reveal',
  protect,
  requireSiteParamAccess(),
  require2fa,
  revealContactoHandler,
);
router.patch(
  '/sites/:siteId/bitacora/contacto/:id',
  protect,
  requireSiteParamAccess(),
  require2fa,
  patchContactoHandler,
);
router.delete(
  '/sites/:siteId/bitacora/contacto/:id',
  protect,
  requireSiteParamAccess(),
  require2fa,
  deleteContactoHandler,
);
router.get(
  '/sites/:siteId/bitacora/equipos',
  protect,
  requireSiteParamAccess(),
  listEquiposHandler,
);
router.post(
  '/sites/:siteId/bitacora/equipos',
  protect,
  requireSiteParamAccess(),
  createEquipoHandler,
);
router.patch('/sites/bitacora/equipos/:id', protect, patchEquipoHandler);
router.delete('/sites/bitacora/equipos/:id', protect, deleteEquipoHandler);

// Mediciones (Detalle de Registros + CSV)
router.get('/dga/dato', protect, queryDatoDgaHandler);
router.get('/dga/dato/export.csv', protect, exportDatoDgaCsvHandler);
router.get('/dga/export-directo.csv', protect, exportDgaDirectoCsvHandler);

// 2FA: unificado en POST /api/2fa/request (twoFactorRoutes + shared/email-otp).
// Todas las acciones sensibles — DGA incluido — usan header X-2FA-Code.

// Review queue: solo Admin/SuperAdmin + scope por sitio en el handler.
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
  require2fa,
  auditDgaMutations,
  reviewSlotActionHandler,
);

// Reconocer sensor defectuoso: marca reg_map + incidencia + acepta backlog.
router.post(
  '/dga/sites/:siteId/reconocer-sensor-defectuoso',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  require2fa,
  auditDgaMutations,
  reconocerSensorDefectuosoHandler,
);

export default router;
