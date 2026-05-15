import type { DgaReport } from '../reports/report.types';

export interface PendingSubmission {
  idDgauser: number;
  obra: string;
  rutInformante: string;
  claveInformante: string;
  report: DgaReport;
  intentos: number;
}
