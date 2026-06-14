/**
 * Middleware v2: autoriza el acceso a un sitio identificado por `:siteId` en la
 * ruta. Cierra los IDOR de los handlers v2 que leían/escribían por siteId sin
 * verificar propiedad (auditoría 2026-06-14: dga/sites, analisis, etc.).
 *
 * Carga el alcance (empresa_id, sub_empresa_id) del sitio y delega en
 * `requireSiteAccess` (shared/permissions), que lanza ForbiddenError si el
 * usuario no tiene permiso. Los errores van al error-middleware v2 (envelope).
 */
import type { Request, Response, NextFunction } from 'express';
import { query } from '../config/dbHelpers';
import { NotFoundError, ValidationError } from '../shared/errors';
import { requireSiteAccess, type AuthUser, type SiteScope } from '../shared/permissions';

/**
 * Variante para handlers que reciben el site_id por query/body (no por `:siteId`
 * en la ruta). Carga el alcance y lanza ForbiddenError si el usuario no accede.
 */
export async function assertSiteAccessById(
  user: AuthUser | undefined,
  siteId: string | null | undefined,
): Promise<void> {
  const id = String(siteId ?? '').trim();
  if (!id) throw new ValidationError('site_id requerido');
  const result = await query<SiteScope>(
    `SELECT empresa_id, sub_empresa_id FROM sitio WHERE UPPER(id) = UPPER($1)`,
    [id],
  );
  const site = result.rows[0];
  if (!site) throw new NotFoundError('Sitio no encontrado.');
  requireSiteAccess(user, site);
}

export function requireSiteParamAccess(paramName = 'siteId') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = (req.params as Record<string, string | undefined>)[paramName];
      const siteId = String(raw ?? '').trim();
      if (!siteId) {
        next(new ValidationError('siteId requerido'));
        return;
      }
      // Match case-insensitive para no fallar por normalización (algunos
      // handlers usan el id en mayúsculas, otros tal cual).
      const result = await query<SiteScope>(
        `SELECT empresa_id, sub_empresa_id FROM sitio WHERE UPPER(id) = UPPER($1)`,
        [siteId],
      );
      const site = result.rows[0];
      if (!site) {
        next(new NotFoundError('Sitio no encontrado.'));
        return;
      }
      const user = (req as Request & { user?: AuthUser }).user;
      requireSiteAccess(user, site); // lanza ForbiddenError si no tiene acceso
      next();
    } catch (err) {
      next(err);
    }
  };
}
