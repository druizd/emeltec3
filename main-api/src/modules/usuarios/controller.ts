/**
 * Reveal del teléfono de un usuario (usuario.telefono).
 *
 * Los listados de usuarios enmascaran el teléfono; este endpoint lo revela
 * puntualmente, exige 2FA (middleware en la ruta) y audita el acceso. Aplica
 * el mismo criterio de visibilidad que getAllUsers, y siempre permite ver el
 * propio.
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

interface UsuarioRow {
  id: string;
  empresa_id: string | null;
  sub_empresa_id: string | null;
  nombre: string;
  apellido: string | null;
  telefono: string | null;
}

/** Mismo criterio de visibilidad que getAllUsers; siempre permite el propio. */
function puedeVer(u: AuthUser | undefined, t: UsuarioRow): boolean {
  if (!u) return false;
  if (u.id != null && String(u.id) === t.id) return true;
  switch (u.tipo) {
    case 'SuperAdmin':
      return true;
    case 'Admin':
    case 'Vendedor':
      return t.empresa_id === u.empresa_id;
    case 'Gerente':
      return t.sub_empresa_id === u.sub_empresa_id;
    default:
      return false;
  }
}

export async function revealUserPhoneHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id) throw new ValidationError('id requerido');
    const r = await query<UsuarioRow>(
      `SELECT id, empresa_id, sub_empresa_id, nombre, apellido, telefono
         FROM usuario WHERE id = $1`,
      [id],
      { name: 'usuario__reveal_phone' },
    );
    const t = r.rows[0];
    if (!t) throw new NotFoundError('Usuario no encontrado');
    const u = getUser(req);
    if (!puedeVer(u, t)) throw new ForbiddenError('Sin acceso a este usuario');

    try {
      await auditRecord({
        req,
        action: 'usuario.telefono.reveal',
        actorId: u?.id != null ? String(u.id) : null,
        actorEmail: u?.email ?? null,
        actorTipo: u?.tipo ?? null,
        targetType: 'usuario',
        targetId: id,
        statusCode: 200,
        metadata: {
          nombre: [t.nombre, t.apellido]
            .filter((s) => s && s.trim())
            .join(' ')
            .trim(),
          campos: ['telefono'],
        },
      });
    } catch (auditErr) {
      console.error('[usuario.telefono.reveal] fallo al auditar:', auditErr);
    }

    res.json(ok({ telefono: t.telefono }, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}
