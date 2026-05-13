import type { DgaReport, ReportQuery } from '../../domain/reports/report.types';
import * as reportsRepo from '../../infrastructure/db/reports.repo';

export async function getReportsBySite(q: ReportQuery): Promise<{ items: DgaReport[]; total: number }> {
  return reportsRepo.findBySite(q);
}
