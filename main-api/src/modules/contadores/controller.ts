/**
 * Controllers HTTP del modulo contadores. Solo lectura: la escritura la hace
 * el worker (modules/contadores/worker.ts) y el script de backfill.
 */
import type { Request, Response, NextFunction } from 'express';
import { ok } from '../../shared/httpEnvelope';
import { ValidationError } from '../../shared/errors';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { z } from 'zod';
import { getDailySeries, getJornadaSeries, getMonthlySeries } from './service';
import { COUNTER_ROLES } from './types';

const HHMM = z.string().regex(/^\d{2}:\d{2}$/, 'formato HH:MM esperado');

const SeriesQuery = z.object({
  rol: z.enum(COUNTER_ROLES).default('totalizador'),
  meses: z.coerce.number().int().min(1).max(36).default(12),
});

const DailySeriesQuery = z.object({
  rol: z.enum(COUNTER_ROLES).default('totalizador'),
  dias: z.coerce.number().int().min(1).max(120).default(30),
});

const JornadaSeriesQuery = z.object({
  rol: z.enum(COUNTER_ROLES).default('totalizador'),
  dias: z.coerce.number().int().min(1).max(120).default(30),
  inicio: HHMM.default('07:00'),
  fin: HHMM.default('07:00'),
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

export async function getJornadaSeriesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  try {
    const siteId = String(req.params.siteId ?? '').trim();
    if (!siteId) throw new ValidationError('siteId requerido');
    const parsed = JornadaSeriesQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Parametros invalidos', { details: parsed.error.issues });
    }
    const series = await getJornadaSeries({
      sitioId: siteId,
      rol: parsed.data.rol,
      dias: parsed.data.dias,
      inicio: parsed.data.inicio,
      fin: parsed.data.fin,
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
