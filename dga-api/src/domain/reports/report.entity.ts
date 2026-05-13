import type { DgaReport } from './report.types';

export function isValidReport(report: Partial<DgaReport>): report is DgaReport {
  if (!report.sitioId || typeof report.sitioId !== 'string') return false;
  if (!(report.timestamp instanceof Date) || Number.isNaN(report.timestamp.getTime())) return false;
  return true;
}

export function buildEmptyReport(sitioId: string, timestamp: Date): DgaReport {
  return {
    sitioId,
    timestamp,
    nivelFreatico: null,
    caudal: null,
    totalizado: null,
  };
}
