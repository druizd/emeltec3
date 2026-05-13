import { Router } from 'express';
import { z } from 'zod';
import { getReportsBySite } from '../../../application/reports/getReportsBySite.usecase';
import type { ReportQuery, DgaReport } from '../../../domain/reports/report.types';
import { paginated } from '../../../shared/envelope';
import { ValidationError } from '../../../shared/errors';
import { authProtect } from '../middlewares/auth';

export const reportsRouter = Router();

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(500).default(50),
});

// Chile continental = UTC-4 sin DST
function toChileFields(ts: Date) {
  const local = new Date(ts.getTime() - 4 * 60 * 60 * 1000);
  const iso = local.toISOString();
  const [yyyy, mm, dd] = iso.slice(0, 10).split('-') as [string, string, string];
  const [hh, min, sec] = iso.slice(11, 19).split(':') as [string, string, string];
  return {
    fecha: `${dd}-${mm}-${yyyy}`,
    hora: `${parseInt(hh)}:${min}:${sec}`,
  };
}

function toResponseItem(r: DgaReport) {
  const { fecha, hora } = toChileFields(r.timestamp);
  return {
    obra: r.obra,
    fecha,
    hora,
    caudalInstantaneo: r.caudal,
    flujoAcumulado: r.totalizado,
    nivelFreatico: r.nivelFreatico,
  };
}

reportsRouter.get('/sites/:sitioId/reports', authProtect, async (req, res, next) => {
  try {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Parámetros inválidos', parsed.error.issues);

    const { from, to, page, pageSize } = parsed.data;
    const query: ReportQuery = {
      sitioId: String(req.params['sitioId']),
      page,
      pageSize,
    };
    if (from) query.from = new Date(from);
    if (to) query.to = new Date(to);

    const { items, total } = await getReportsBySite(query);
    res.json(paginated(items.map(toResponseItem), page, pageSize, total));
  } catch (err) {
    next(err);
  }
});
