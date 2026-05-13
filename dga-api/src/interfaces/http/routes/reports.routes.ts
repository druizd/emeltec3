import { Router } from 'express';
import { z } from 'zod';
import { getReportsBySite } from '../../../application/reports/getReportsBySite.usecase';
import type { ReportQuery } from '../../../domain/reports/report.types';
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

    res.json(paginated(items, page, pageSize, total));
  } catch (err) {
    next(err);
  }
});
