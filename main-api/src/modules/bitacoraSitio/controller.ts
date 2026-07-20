/**
 * Controllers HTTP v2 — Bitácora del sitio.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import {
  deleteContactoSitio,
  deleteEquipo,
  findContactoSitioId,
  findEquipoSitioId,
  getContactoPII,
  getFicha,
  insertContactoSitio,
  insertEquipo,
  listEquipos,
  patchEquipo,
  patchFicha,
  updateContactoSitio,
  filterDocumentoIdsDelSitio,
} from './repo';
import { maskFicha } from './mask';
import {
  CreateContactoPayload,
  CreateEquipoPayload,
  FichaPayload,
  PatchContactoPayload,
  PatchEquipoPayload,
} from './schema';
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
    res.json(ok(maskFicha(f), { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

/** Best-effort audit de una acción sobre un contacto. Nunca rompe la respuesta. */
async function auditContacto(
  req: Request,
  action: string,
  siteId: string,
  contactoId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const u = getUser(req);
  try {
    await auditRecord({
      req,
      action,
      actorId: u?.id != null ? String(u.id) : null,
      actorEmail: u?.email ?? null,
      actorTipo: u?.tipo ?? null,
      targetType: 'contacto_operativo',
      targetId: `${siteId}#${contactoId}`,
      statusCode: 200,
      metadata,
    });
  } catch (auditErr) {
    console.error(`[${action}] fallo al auditar:`, auditErr);
  }
}

/** Valida :id y que el contacto pertenezca al :siteId de la ruta (anti-IDOR). */
async function resolveContacto(req: Request): Promise<{ siteId: string; id: number }> {
  const siteId = String(req.params.siteId ?? '').trim();
  const id = Number(req.params.id);
  if (!siteId) throw new ValidationError('siteId requerido');
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('id inválido');
  const owner = await findContactoSitioId(id);
  if (owner !== siteId) throw new NotFoundError('Contacto no encontrado');
  return { siteId, id };
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
    const { siteId, id } = await resolveContacto(req);
    const pii = await getContactoPII(id);
    if (!pii) throw new NotFoundError('Contacto no encontrado');
    await auditContacto(req, 'bitacora.contacto.reveal', siteId, id, {
      nombre: pii.nombre,
      campos: ['telefono', 'email'],
    });
    res.json(
      ok({ telefono: pii.telefono, email: pii.email }, { durationMs: elapsedMs(startedAt) }),
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
    // Los contactos NO viven acá (son contacto_operativo): patchFicha ignora
    // los del payload y persiste solo pin/acreditaciones/riesgos.
    const updated = await patchFicha(siteId, {
      pin_critico: parsed.data.pin_critico ?? null,
      contactos: [],
      acreditaciones: parsed.data.acreditaciones,
      riesgos: parsed.data.riesgos,
    });
    res.json(ok(maskFicha(updated), { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Contactos (PII → contacto_operativo; endpoints con 2FA + auditoría)
// ============================================================================

export async function createContactoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = CreateContactoPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const created = await insertContactoSitio({
      siteId,
      nombre: parsed.data.nombre,
      rol: parsed.data.rol,
      telefono: parsed.data.telefono ?? null,
      email: parsed.data.email ?? null,
    });
    await auditContacto(req, 'bitacora.contacto.create', siteId, Number(created.id), {
      nombre: created.nombre,
      rol: created.rol,
    });
    res
      .status(201)
      .json(ok(maskFicha(await getFicha(siteId)), { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function patchContactoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const { siteId, id } = await resolveContacto(req);
    const parsed = PatchContactoPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const updated = await updateContactoSitio(id, {
      ...(parsed.data.nombre !== undefined ? { nombre: parsed.data.nombre } : {}),
      ...(parsed.data.rol !== undefined ? { rol: parsed.data.rol } : {}),
      // vacío/undefined → COALESCE preserva el valor guardado en el repo.
      telefono: parsed.data.telefono || null,
      email: parsed.data.email || null,
    });
    if (!updated) throw new NotFoundError('Contacto no encontrado');
    await auditContacto(req, 'bitacora.contacto.update', siteId, id, {
      nombre: updated.nombre,
      rol: updated.rol,
    });
    res.json(ok(maskFicha(await getFicha(siteId)), { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function deleteContactoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const { siteId, id } = await resolveContacto(req);
    const okDelete = await deleteContactoSitio(id);
    if (!okDelete) throw new NotFoundError('Contacto no encontrado');
    await auditContacto(req, 'bitacora.contacto.delete', siteId, id, {});
    res.json(ok(maskFicha(await getFicha(siteId)), { durationMs: elapsedMs(startedAt) }));
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
    // Descarta ids de documento que no pertenezcan al sitio (self-healing).
    const documento_ids = await filterDocumentoIdsDelSitio(siteId, parsed.data.documento_ids);
    const row = await insertEquipo({ sitio_id: siteId, ...parsed.data, documento_ids });
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
    // Si se envían documento_ids, descarta los que no sean del sitio.
    const data =
      parsed.data.documento_ids !== undefined
        ? {
            ...parsed.data,
            documento_ids: await filterDocumentoIdsDelSitio(sitioId, parsed.data.documento_ids),
          }
        : parsed.data;
    const row = await patchEquipo(id, data);
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
