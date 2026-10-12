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
import { loginHandler, requestCodeHandler, viewAsHandler } from '../../modules/auth/controller';
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
  bulkSlotActionHandler,
  slotsResumenHandler,
  reviewSlotActionHandler,
  reviewBulkActionHandler,
  upsertInformanteHandler,
} from '../../modules/dga/controller';
import { require2fa } from '../../shared/email-otp';
import { require2faIfSensitiveChange } from '../../modules/dga/twofactor-guards';
import { ForbiddenError } from '../../shared/errors';
import type { AuthUser } from '../../shared/permissions';
import { resolveV2Audit } from './auditResolver';
import type { AuditInfo } from './auditResolver';

// auditLog es CJS legacy: bitácora append-only para mutaciones (Ley 21.663 §32).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditMutations } = require('../../services/auditLog') as {
  auditMutations: (resolver: (req: Request) => AuditInfo) => RequestHandler;
};

/** Bloquea acceso DGA de escritura a usuarios Vendedor (empresas tipo Demo). */
function blockDemoAccess(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user?: AuthUser }).user;
  if (user?.tipo === 'Vendedor') {
    return next(new ForbiddenError('Acceso DGA no disponible en modo demo.'));
  }
  next();
}

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

// Auditoría de TODA escritura del router, una sola vez y ANTES de `protect`: así
// un rechazo (403 de "ver como", de rol o de 2FA) también deja fila, como en v1
// (app.js). Va después de las rutas públicas de login, que no tienen actor. Las
// rutas no montan audit propio: el resolver (auditResolver.ts) cubre DGA, digest
// y bitácora; lo no mapeado cae en `v2.<método>.sin_mapear`.
router.use(auditMutations(resolveV2Audit));
// "Ver como" de SuperAdmin: emite un token de 30 min, SOLO LECTURA, con el rol y
// alcance elegidos. El handler exige SuperAdmin real (no un token act_as). Sin
// require2fa: el token no escribe nada y el SuperAdmin ya lee todo; el 2FA queda
// para las acciones que mutan o revelan PII.
router.post('/auth/view-as', protect, viewAsHandler);

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
  upsertInformanteHandler,
);
router.patch(
  '/dga/informantes/:rut',
  protect,
  authorizeRoles('SuperAdmin'),
  require2faIfPasswordChange,
  upsertInformanteHandler,
);
router.delete(
  '/dga/informantes/:rut',
  protect,
  authorizeRoles('SuperAdmin'),
  require2fa,
  deleteInformanteHandler,
);

// Config DGA por pozo. Activar transport=rest o dga_gcs_export=true exige 2FA.
router.get(
  '/dga/sites/:siteId/pozo-config',
  protect,
  blockDemoAccess,
  requireSiteParamAccess(),
  getPozoDgaConfigHandler,
);
router.patch(
  '/dga/sites/:siteId/pozo-config',
  protect,
  blockDemoAccess,
  requireSiteParamAccess(),
  require2faIfSensitiveChange,
  patchPozoDgaConfigHandler,
);
router.get(
  '/dga/sites/:siteId/live-preview',
  protect,
  blockDemoAccess,
  requireSiteParamAccess(),
  getDgaLivePreviewHandler,
);
router.get(
  '/dga/sites/:siteId/ultimo-envio',
  protect,
  blockDemoAccess,
  requireSiteParamAccess(),
  getUltimoEnvioHandler,
);
router.get(
  '/dga/sites/:siteId/verify',
  protect,
  blockDemoAccess,
  requireSiteParamAccess(),
  verifySniaHandler,
);

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
import { revealUserPhoneHandler } from '../../modules/usuarios/controller';

router.post('/companies/contacts/:id/reveal', protect, require2fa, revealOperationalContactHandler);

// Reveal del teléfono de un usuario (listados van enmascarados). 2FA + audit.
router.post('/users/:id/reveal', protect, require2fa, revealUserPhoneHandler);

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
// blockDemoAccess acá y no solo en los .csv de abajo: sin esto un Vendedor
// lee exactamente los mismos datos en JSON y el bloqueo de la descarga es
// decorativo.
router.get('/dga/dato', protect, blockDemoAccess, queryDatoDgaHandler);
router.get('/dga/dato/export.csv', protect, blockDemoAccess, exportDatoDgaCsvHandler);
router.get('/dga/export-directo.csv', protect, blockDemoAccess, exportDgaDirectoCsvHandler);

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
  reviewSlotActionHandler,
);

// Misma decisión sobre varios slots sueltos de la cola: UN 2FA y UNA entrada
// de auditoría para todo el lote. Antes el frontend abanicaba una petición por
// slot y, como el código es de un solo uso, un lote de 128 pedía 128 códigos.
router.post(
  '/dga/review-queue/bulk',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  require2fa,
  reviewBulkActionHandler,
);

// Resumen por estado del rango: lectura, alimenta la confirmacion previa.
router.get(
  '/dga/sites/:siteId/slots/resumen',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  slotsResumenHandler,
);

// Acción en bloque sobre un rango de slots: recalcular (vuelven a 'vacio' para
// que el fill los recompute con la config actual) o dar de baja documentada.
// Nunca toca 'enviado' ni 'enviando'. Mismas guardas que el descarte de a uno.
router.post(
  '/dga/sites/:siteId/slots/bulk',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  require2fa,
  bulkSlotActionHandler,
);

// Reconocer sensor defectuoso: marca reg_map + incidencia + acepta backlog.
router.post(
  '/dga/sites/:siteId/reconocer-sensor-defectuoso',
  protect,
  authorizeRoles('SuperAdmin', 'Admin'),
  require2fa,
  reconocerSensorDefectuosoHandler,
);

// =====================================================================
// Monitoreo interno (healthDigest): destinatarios del resumen diario y de
// las escalaciones. Es config del equipo Emeltec, no de un tenant → solo
// SuperAdmin. Mutaciones auditadas (Ley 21.663 §32).
// =====================================================================
import {
  listDigestDestinatariosHandler,
  replaceDigestDestinatariosHandler,
  require2faIfNuevoDestinatario,
  saveDigestConfigHandler,
  sendDigestPruebaHandler,
} from '../../modules/healthDigest/destinatariosController';

router.get(
  '/health-digest/destinatarios',
  protect,
  authorizeRoles('SuperAdmin'),
  listDigestDestinatariosHandler,
);
// Agregar una dirección nueva exige 2FA (el resumen nombra instalaciones y
// empresas); editar o quitar direcciones ya autorizadas, no.
router.put(
  '/health-digest/destinatarios',
  protect,
  authorizeRoles('SuperAdmin'),
  require2faIfNuevoDestinatario,
  replaceDigestDestinatariosHandler,
);
// Programación del resumen: horas de envío y umbral de horas sin transmitir.
// Sin 2FA — cambiar la hora de un correo que ya reciben no saca datos afuera.
router.put('/health-digest/config', protect, authorizeRoles('SuperAdmin'), saveDigestConfigHandler);
router.post(
  '/health-digest/prueba',
  protect,
  authorizeRoles('SuperAdmin'),
  sendDigestPruebaHandler,
);

export default router;
