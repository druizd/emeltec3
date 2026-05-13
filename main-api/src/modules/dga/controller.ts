/**
 * Controllers HTTP v2 del módulo DGA.
 * El insert de dato_dga lo realiza el worker (no expuesto manualmente).
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { CreateDgaUserPayload, QueryDatoDgaParams } from './schema';
import { createDgaUser, getDatoDga, getDgaUsersBySite, toCsv } from './service';

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
    const rows = await getDatoDga(parsed.data.id_dgauser, parsed.data.desde, parsed.data.hasta);
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
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
    const rows = await getDatoDga(parsed.data.id_dgauser, parsed.data.desde, parsed.data.hasta);
    const csv = toCsv(rows);
    const filename = `dga_${parsed.data.id_dgauser}_${parsed.data.desde.slice(0, 10)}_${parsed.data.hasta.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    next(err);
  }
}
