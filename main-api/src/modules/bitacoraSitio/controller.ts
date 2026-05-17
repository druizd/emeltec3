/**
 * Controllers HTTP v2 — Bitácora del sitio.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import {
  deleteEquipo,
  getFicha,
  insertEquipo,
  listEquipos,
  patchEquipo,
  patchFicha,
} from './repo';
import { CreateEquipoPayload, FichaPayload, PatchEquipoPayload } from './schema';

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
    res.json(ok(f, { durationMs: elapsedMs(startedAt) }));
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
    const okDelete = await deleteEquipo(id);
    if (!okDelete) throw new NotFoundError('Equipo no encontrado');
    res.json(ok({ deleted: true }, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}
