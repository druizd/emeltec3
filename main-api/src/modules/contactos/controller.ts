/**
 * Reveal de PII de contactos operativos (contacto_operativo).
 *
 * El listado (/api/companies/contacts) enmascara tel/email para todos los
 * roles; este endpoint los revela puntualmente, exige 2FA (middleware en la
 * ruta) y audita el acceso. Aplica el MISMO scoping por rol que el listado.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { query } from '../../config/dbHelpers';
import type { AuthUser } from '../../shared/permissions';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { record: auditRecord } = require('../../services/auditLog') as {
  record: (args: {
    req: Request;
    action: string;
    actorId?: string | null;
    actorEmail?: string | null;
    actorTipo?: string | null;
    targetType?: string;
    targetId?: string;
    statusCode?: number;
    metadata?: unknown;
  }) => Promise<void> | void;
};

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

interface ContactoRow {
  empresa_id: string;
  sub_empresa_id: string;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
  email: string | null;
}

/** Mismo criterio de visibilidad que listOperationalContacts. */
function puedeVer(u: AuthUser | undefined, c: ContactoRow): boolean {
  if (!u) return false;
  switch (u.tipo) {
    case 'SuperAdmin':
      return true;
    case 'Admin':
    case 'Vendedor':
      return c.empresa_id === u.empresa_id;
    case 'Gerente':
    case 'Cliente':
      return c.empresa_id === u.empresa_id && c.sub_empresa_id === u.sub_empresa_id;
    default:
      return false;
  }
}

export async function revealOperationalContactHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw new ValidationError('id inválido');
    const r = await query<ContactoRow>(
      `SELECT empresa_id, sub_empresa_id, nombre, apellido, telefono, email
         FROM contacto_operativo WHERE id = $1`,
      [id],
      { name: 'contacto__reveal' },
    );
    const c = r.rows[0];
    if (!c) throw new NotFoundError('Contacto no encontrado');
    const u = getUser(req);
    if (!puedeVer(u, c)) throw new ForbiddenError('Sin acceso a este contacto');

    try {
      await auditRecord({
        req,
        action: 'contacto.reveal',
        actorId: u?.id != null ? String(u.id) : null,
        actorEmail: u?.email ?? null,
        actorTipo: u?.tipo ?? null,
        targetType: 'contacto_operativo',
        targetId: String(id),
        statusCode: 200,
        metadata: {
          nombre: [c.nombre, c.apellido]
            .filter((s) => s && s.trim())
            .join(' ')
            .trim(),
          campos: ['telefono', 'email'],
        },
      });
    } catch (auditErr) {
      // No romper la respuesta, pero dejar rastro del fallo de auditoría.
      console.error('[contacto.reveal] fallo al auditar:', auditErr);
    }

    res.json(ok({ telefono: c.telefono, email: c.email }, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}
