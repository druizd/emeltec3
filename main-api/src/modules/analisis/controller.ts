/**
 * Controllers HTTP v2 — Análisis del sitio.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { getMetricas, getReportesRecientes, getSalud } from './repo';

const MetricasParams = z.object({
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
});

const ReportesParams = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export async function getSaludHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const data = await getSalud(siteId);
    res.json(ok(data, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function getMetricasHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = MetricasParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const data = await getMetricas(siteId, parsed.data.desde, parsed.data.hasta);
    res.json(ok(data, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function getReportesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = ReportesParams.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parámetros inválidos', { details: parsed.error.issues });
    }
    const rows = await getReportesRecientes(siteId, parsed.data.limit);
    res.json(ok(rows, { count: rows.length, durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}
