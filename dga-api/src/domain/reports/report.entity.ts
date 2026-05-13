// Operaciones puras sobre la entidad DgaReport: validar y construir.
import type { DgaReport } from './report.types';

// Guard: confirma que el reporte tiene los campos mínimos para persistir/enviar.
// Las métricas pueden ser null; sitioId y timestamp son obligatorios.
export function isValidReport(report: Partial<DgaReport>): report is DgaReport {
  if (!report.sitioId || typeof report.sitioId !== 'string') return false;
  if (!(report.timestamp instanceof Date) || Number.isNaN(report.timestamp.getTime())) return false;
  return true;
}

// Crea un reporte "vacío" con todas las métricas en null.
// Las usecases lo van rellenando según los reg_map disponibles en el sitio.
export function buildEmptyReport(sitioId: string, timestamp: Date): DgaReport {
  return {
    sitioId,
    timestamp,
    nivelFreatico: null,
    caudal: null,
    totalizado: null,
  };
}
