/**
 * Guards Express que condicionan la exigencia de 2FA en mutaciones DGA.
 * Extraído de http/v2/routes.ts para poder testearse en aislamiento (routes.ts
 * arrastra demasiadas dependencias para un unit test).
 */
import type { Request, Response, NextFunction } from 'express';
import { requireDgaTwoFactor } from './twofactor';

/**
 * Exige 2FA para cambios sensibles del PATCH pozo-config:
 *   - dga_transport → 'rest' (empieza a enviar a SNIA).
 *   - dga_gcs_export → true (empieza a publicar registros a GCS; dev CCU).
 * Otros cambios (caudal_max, periodicidad, etc.) pasan derecho al handler.
 * Desactivar dga_gcs_export (false) NO requiere 2FA.
 */
export function require2faIfSensitiveChange(req: Request, res: Response, next: NextFunction): void {
  if (req.body?.dga_transport === 'rest' || req.body?.dga_gcs_export === true) {
    return requireDgaTwoFactor(req, res, next);
  }
  next();
}
