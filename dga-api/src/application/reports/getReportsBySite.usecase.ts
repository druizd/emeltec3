// Caso de uso de consulta: lista reportes de un sitio paginados.
// Por ahora es un thin-wrapper del repo; existe para que la ruta HTTP no acople directo a infraestructura.
import type { DgaReport, ReportQuery } from '../../domain/reports/report.types';
import * as reportsRepo from '../../infrastructure/db/reports.repo';

export async function getReportsBySite(q: ReportQuery): Promise<{ items: DgaReport[]; total: number }> {
  return reportsRepo.findBySite(q);
}
