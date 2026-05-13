/**
 * Controllers HTTP v2 del módulo DGA.
 * El insert de dato_dga lo realiza el worker (no expuesto manualmente).
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { z } from 'zod';
import { CreateDgaUserPayload, QueryDatoDgaParams } from './schema';
import {
  createDgaUser,
  getDatoDga,
  getDatoDgaBySite,
  getDatoDgaDirectoFromEquipo,
  getDgaUsersBySite,
  toCsv,
} from './service';

const ExportDirectoParams = z.object({
  site_id: z.string().trim().min(1).max(10),
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
});

export async function createDgaUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const parsed = CreateDgaUserPayload.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.issues });
    }
    const created = await createDgaUser(parsed.data);
    res.status(201).json(ok(created, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function listDgaUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const rows = await getDgaUsersBySite(siteId);
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

async function fetchDatoRows(p: QueryDatoDgaParams) {
  if (p.id_dgauser !== undefined) {
    return getDatoDga(p.id_dgauser, p.desde, p.hasta);
  }
  return getDatoDgaBySite(p.site_id as string, p.desde, p.hasta);
}

export async function queryDatoDgaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const parsed = QueryDatoDgaParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await fetchDatoRows(parsed.data);
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

/**
 * Descarga manual: arma CSV DGA directo desde `equipo` aplicando las mismas
 * transformaciones del dashboard. No requiere informante registrado.
 */
export async function exportDgaDirectoCsvHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ExportDirectoParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await getDatoDgaDirectoFromEquipo(
      parsed.data.site_id,
      parsed.data.desde,
      parsed.data.hasta,
    );
    const csv = toCsv(rows);
    const filename = `dga_${parsed.data.site_id}_${parsed.data.desde.slice(0, 10)}_${parsed.data.hasta.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
}

export async function exportDatoDgaCsvHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = QueryDatoDgaParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await fetchDatoRows(parsed.data);
    const csv = toCsv(rows);
    const key = parsed.data.site_id ?? parsed.data.id_dgauser;
    const filename = `dga_${key}_${parsed.data.desde.slice(0, 10)}_${parsed.data.hasta.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
}
