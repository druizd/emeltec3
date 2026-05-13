export interface DgaReport {
  sitioId: string;
  timestamp: Date;
  nivelFreatico: number | null;
  caudal: number | null;
  totalizado: number | null;
}

export interface DgaReportRow extends DgaReport {
  receivedAt?: Date;
}

export interface ReportQuery {
  sitioId: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}
