/**
 * Controllers HTTP v2 — Análisis del sitio.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { getMetricas, getSalud } from './repo';

const MetricasParams = z.object({
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
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

