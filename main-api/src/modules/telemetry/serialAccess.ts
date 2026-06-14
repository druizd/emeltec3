/**
 * Middleware de autorización de serial para los endpoints v2 de telemetría.
 *
 * Cierra el IDOR de la capa v2 (auditoría 2026-06-14): antes `/api/v2/telemetry/*`
 * no tenía `protect` y leía el serial de la query sin verificar propiedad.
 *
 * Reutiliza la MISMA lógica que la capa v1 (`services/dataAccess`) para que no
 * diverjan: SuperAdmin todo; Admin su empresa; Gerente/Cliente su sub-empresa
 * (o toda la empresa si no tienen sub-empresa asignada).
 */
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../shared/errors';
import type { AuthUser } from '../../shared/permissions';
// Módulos v1 (CommonJS) reutilizados — habilitado por allowJs.
import pool from '../../config/db';
import { resolveAccessibleSerial } from '../../services/dataAccess';

export type RequestWithSerial = Request & { user?: AuthUser; dataSerial?: string | null };

/**
 * Resuelve y autoriza el serial del request. Deja el serial accesible en
 * `req.dataSerial` (puede ser null si el usuario no tiene equipos). Responde 403
 * si se pidió un serial que no pertenece al alcance del usuario.
 */
export async function requireTelemetrySerialAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const r = req as RequestWithSerial;
    const q = req.query as Record<string, unknown>;
    let requested: unknown = q.serial_id ?? q.id_serial ?? null;
    if (Array.isArray(requested)) requested = requested[0] ?? null;
    const requestedSerial = requested == null ? null : String(requested).trim() || null;

    const result = await resolveAccessibleSerial(pool, r.user, requestedSerial);
    if (result && typeof result === 'object' && 'forbidden' in result) {
      next(new ForbiddenError('No tiene permisos sobre este equipo'));
      return;
    }
    r.dataSerial = (result as { serial: string | null }).serial;
    next();
  } catch (err) {
    next(err);
  }
}

/** Lee el serial autorizado dejado por el middleware. */
export function authorizedSerial(req: Request): string | null {
  return (req as RequestWithSerial).dataSerial ?? null;
}
