/**
 * Controllers HTTP del modulo contadores. Solo lectura: la escritura la hace
 * el worker (modules/contadores/worker.ts) y el script de backfill.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { z } from 'zod';
import { getDailySeries, getMonthlySeries } from './service';
import { COUNTER_ROLES } from './types';

const SeriesQuery = z.object({
  rol: z.enum(COUNTER_ROLES).default('totalizador'),
  meses: z.coerce.number().int().min(1).max(36).default(12),
});

const DailySeriesQuery = z.object({
  rol: z.enum(COUNTER_ROLES).default('totalizador'),
  dias: z.coerce.number().int().min(1).max(120).default(30),
});

export async function getMonthlySeriesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = SeriesQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }
    const series = await getMonthlySeries({
      sitioId: siteId,
      rol: parsed.data.rol,
      meses: parsed.data.meses,
    });
    res.json(
      ok(series, {
        count: series.length,
        durationMs: elapsedMs(startedAt),
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getDailySeriesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = DailySeriesQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }
    const series = await getDailySeries({
      sitioId: siteId,
      rol: parsed.data.rol,
      dias: parsed.data.dias,
    });
    res.json(
      ok(series, {
        count: series.length,
        durationMs: elapsedMs(startedAt),
      }),
    );
  } catch (err) {
    next(err);
  }
}
