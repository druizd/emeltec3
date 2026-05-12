/**
 * Controladores HTTP v2 del módulo sites.
 * Thin: zod → service → envelope.
 */
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../../shared/httpEnvelope';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { requireSiteAccess } from '../../shared/permissions';
import type { AuthUser } from '../../shared/permissions';
import { elapsedMs, nowHrtime } from '../../shared/time';
import { loadDashboardData, loadDashboardHistory } from './service';

const siteIdParam = z.object({
  siteId: z
    .string()
    .min(1)
    .transform((v) => v.trim().toUpperCase()),
});

const historyQuery = z.object({
  limit: z.coerce.number().int().positive().max(2500).default(500),
});

function getUser(req: Request): AuthUser | undefined {
  return (req as Request & { user?: AuthUser }).user;
}

export async function getDashboardDataHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const params = siteIdParam.safeParse(req.params);
  if (!params.success) return next(new ValidationError('siteId requerido'));
  try {
    const loaded = await loadDashboardData(params.data.siteId);
    if (!loaded) throw new NotFoundError('Sitio no encontrado.');
    requireSiteAccess(getUser(req), loaded.site);
    res.json(ok(loaded.data, { durationMs: elapsedMs(startedAt) }));
  } catch (err) {
    next(err);
  }
}

export async function getDashboardHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = nowHrtime();
  const params = siteIdParam.safeParse(req.params);
  const queryParsed = historyQuery.safeParse(req.query);
  if (!params.success) return next(new ValidationError('siteId requerido'));
  if (!queryParsed.success) {
    return next(new ValidationError('Query inválida', { details: queryParsed.error.flatten() }));
  }
  try {
    const loaded = await loadDashboardHistory(params.data.siteId, queryParsed.data.limit);
    if (!loaded) throw new NotFoundError('Sitio no encontrado.');
    requireSiteAccess(getUser(req), loaded.site);
    res.json(
      ok(
        {
          site: {
            id: loaded.site.id,
            descripcion: loaded.site.descripcion,
            id_serial: loaded.site.id_serial,
            tipo_sitio: loaded.site.tipo_sitio,
            activo: loaded.site.activo,
          },
          rows: loaded.rows,
        },
        {
          count: loaded.rows.length,
          pagination: { limit: queryParsed.data.limit, page_size: 50 },
          durationMs: elapsedMs(startedAt),
        },
      ),
    );
  } catch (err) {
    next(err);
  }
}
