/**
 * Controllers HTTP v2 — Bitácora del sitio.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import {
  deleteEquipo,
  findEquipoSitioId,
  getFicha,
  insertEquipo,
  listEquipos,
  patchEquipo,
  patchFicha,
  type FichaContacto,
  type FichaSitio,
} from './repo';
import { CreateEquipoPayload, FichaPayload, PatchEquipoPayload } from './schema';
import { assertSiteAccessById } from '../../middlewares/siteAccess';
import type { AuthUser } from '../../shared/permissions';

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

// Audit-log (CJS legacy) — mismo patrón que routes.ts.
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

/**
 * Enmascara datos personales de terceros (tel/email de contactos) para el rol
 * Cliente. El dato real NO sale del servidor; se revela por endpoint con 2FA.
 * Minimización + accountability (Ley 21.719).
 */
function maskFichaForRole(f: FichaSitio, tipo: string | undefined): FichaSitio {
  if (tipo !== 'Cliente') return f;
  return {
    ...f,
    contactos: f.contactos.map((c) => ({
      nombre: c.nombre,
      rol: c.rol,
      telefono: null,
      email: null,
      datos_ocultos: Boolean(c.telefono || c.email),
    })),
  };
}

// ============================================================================
// Ficha
// ============================================================================

export async function getFichaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const f = await getFicha(siteId);
    res.json(ok(maskFichaForRole(f, getUser(req)?.tipo), { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

/**
 * Revela tel/email de un contacto puntual. Protegido por 2FA (middleware) y
 * auditado: registra quién reveló datos personales de un tercero, cuándo.
 */
export async function revealContactoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    const idx = Number(req.params.idx);
    if (!siteId) throw new ValidationError('siteId requerido');
    if (!Number.isFinite(idx) || idx < 0) throw new ValidationError('idx inválido');
    const f = await getFicha(siteId);
    const c: FichaContacto | undefined = f.contactos[idx];
    if (!c) throw new NotFoundError('Contacto no encontrado');
    const u = getUser(req);
    try {
      await auditRecord({
        req,
        action: 'bitacora.contacto.reveal',
        actorId: u?.id != null ? String(u.id) : null,
        actorEmail: u?.email ?? null,
        actorTipo: u?.tipo ?? null,
        targetType: 'bitacora_contacto',
        targetId: `${siteId}#${idx}`,
        statusCode: 200,
        metadata: { nombre: c.nombre, rol: c.rol, campos: ['telefono', 'email'] },
      });
    } catch {
      // Auditar no debe romper la respuesta; si falla, se sirve igual.
    }
    res.json(
      ok(
        { telefono: c.telefono ?? null, email: c.email ?? null },
        { durationMs: elapsedMs(startedAt) },
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function patchFichaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = FichaPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const updated = await patchFicha(siteId, {
      pin_critico: parsed.data.pin_critico ?? null,
      contactos: parsed.data.contactos,
      acreditaciones: parsed.data.acreditaciones,
      riesgos: parsed.data.riesgos,
    });
    res.json(ok(updated, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Equipos
// ============================================================================

export async function listEquiposHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const rows = await listEquipos(siteId);
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function createEquipoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = CreateEquipoPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const row = await insertEquipo({ sitio_id: siteId, ...parsed.data });
    res.status(201).json(ok(row, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function patchEquipoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw new ValidationError('id inválido');
    // IDOR: el equipo se direcciona por id numérico; verificar que su sitio
    // pertenezca al usuario antes de modificarlo.
    const sitioId = await findEquipoSitioId(id);
    if (!sitioId) throw new NotFoundError('Equipo no encontrado');
    await assertSiteAccessById(getUser(req), sitioId);
    const parsed = PatchEquipoPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const row = await patchEquipo(id, parsed.data);
    if (!row) throw new NotFoundError('Equipo no encontrado');
    res.json(ok(row, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function deleteEquipoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw new ValidationError('id inválido');
    const sitioId = await findEquipoSitioId(id);
    if (!sitioId) throw new NotFoundError('Equipo no encontrado');
    await assertSiteAccessById(getUser(req), sitioId);
    const okDelete = await deleteEquipo(id);
    if (!okDelete) throw new NotFoundError('Equipo no encontrado');
    res.json(ok({ deleted: true }, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}
