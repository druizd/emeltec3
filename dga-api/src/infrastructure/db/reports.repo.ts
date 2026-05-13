import type { DgaReport, ReportQuery } from '../../domain/reports/report.types';

// TODO(bloqueado): la hypertable destino la define el compañero.
//   Cuando confirme nombre + columnas, completar las queries.
//   Estructura tentativa: hypertable `dga` con
//     (timestamp TIMESTAMPTZ, sitio_id VARCHAR, nivel_freatico NUMERIC,
//      caudal NUMERIC, totalizado BIGINT, PK (sitio_id, timestamp))

const TABLE = process.env.DGA_REPORTS_TABLE || 'dga';

export async function insertReport(_report: DgaReport): Promise<void> {
  void TABLE;
  throw new Error('NOT_IMPLEMENTED: reports.repo.insertReport — falta nombre real de hypertable');
}

export async function findBySite(_q: ReportQuery): Promise<{ items: DgaReport[]; total: number }> {
  throw new Error('NOT_IMPLEMENTED: reports.repo.findBySite — falta nombre real de hypertable');
}
