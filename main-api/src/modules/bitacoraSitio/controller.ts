/**
 * Controllers HTTP v2 — Bitácora del sitio.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import {
  addContacto,
  deleteContacto,
  deleteEquipo,
  findEquipoSitioId,
  getFicha,
  insertEquipo,
  listEquipos,
  patchEquipo,
  patchFicha,
  updateContacto,
  filterDocumentoIdsDelSitio,
  type FichaContacto,
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
    } catch (auditErr) {
      // Auditar no debe romper la respuesta; si falla, se sirve igual. Pero
      // NO en silencio: se revela PII de un tercero, el fallo de auditoría
      // debe quedar en el log para no perder trazabilidad (Ley 21.719).
      console.error('[bitacora.contacto.reveal] fallo al auditar:', auditErr);
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
    // Los contactos NO se tocan por esta vía: son PII y se gestionan por sus
    // endpoints dedicados con 2FA. Preservamos los almacenados para que un
    // guardado de ficha (pin/acreditaciones/riesgos) con contactos enmascarados
    // no borre tel/email reales.
    const stored = await getFicha(siteId);
    const updated = await patchFicha(siteId, {
      pin_critico: parsed.data.pin_critico ?? null,
      contactos: stored.contactos,
      acreditaciones: parsed.data.acreditaciones,
      riesgos: parsed.data.riesgos,
    });
    res.json(ok(maskFicha(updated), { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// Contactos (PII — endpoints dedicados con 2FA + auditoría)
// ============================================================================

/** Registra en el audit-log una mutación de contacto (best-effort). */
async function auditContacto(
  req: Request,
  action: string,
  siteId: string,
  idx: number | null,
  c: Pick<FichaContacto, 'nombre' | 'rol'>,
): Promise<void> {
  const u = getUser(req);
  try {
    await auditRecord({
      req,
      action,
      actorId: u?.id != null ? String(u.id) : null,
      actorEmail: u?.email ?? null,
      actorTipo: u?.tipo ?? null,
      targetType: 'bitacora_contacto',
      targetId: idx != null ? `${siteId}#${idx}` : siteId,
      statusCode: 200,
      metadata: { nombre: c.nombre, rol: c.rol },
    });
  } catch (auditErr) {
    console.error(`[${action}] fallo al auditar:`, auditErr);
  }
}

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
    const updated = await addContacto(siteId, {
      nombre: parsed.data.nombre,
      rol: parsed.data.rol,
      telefono: parsed.data.telefono ?? null,
      email: parsed.data.email ?? null,
    });
    await auditContacto(req, 'bitacora.contacto.create', siteId, null, parsed.data);
    res.status(201).json(ok(maskFicha(updated), { durationMs: elapsedMs(startedAt) }));
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
    const siteId = String(req.params.siteId ?? '').trim();
    const idx = Number(req.params.idx);
    if (!siteId) throw new ValidationError('siteId requerido');
    if (!Number.isFinite(idx) || idx < 0) throw new ValidationError('idx inválido');
    const parsed = PatchContactoPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const updated = await updateContacto(siteId, idx, {
      ...(parsed.data.nombre !== undefined ? { nombre: parsed.data.nombre } : {}),
      ...(parsed.data.rol !== undefined ? { rol: parsed.data.rol } : {}),
      ...(parsed.data.telefono != null ? { telefono: parsed.data.telefono } : {}),
      ...(parsed.data.email != null ? { email: parsed.data.email } : {}),
    });
    if (!updated) throw new NotFoundError('Contacto no encontrado');
    await auditContacto(req, 'bitacora.contacto.update', siteId, idx, {
      nombre: parsed.data.nombre ?? '',
      rol: parsed.data.rol ?? '',
    });
    res.json(ok(maskFicha(updated), { durationMs: elapsedMs(startedAt) }));
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
    const siteId = String(req.params.siteId ?? '').trim();
    const idx = Number(req.params.idx);
    if (!siteId) throw new ValidationError('siteId requerido');
    if (!Number.isFinite(idx) || idx < 0) throw new ValidationError('idx inválido');
    const updated = await deleteContacto(siteId, idx);
    if (!updated) throw new NotFoundError('Contacto no encontrado');
    await auditContacto(req, 'bitacora.contacto.delete', siteId, idx, { nombre: '', rol: '' });
    res.json(ok(maskFicha(updated), { durationMs: elapsedMs(startedAt) }));
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
