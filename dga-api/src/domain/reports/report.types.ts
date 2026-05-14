// Modelos del dominio "reporte DGA". Solo tipos; sin lógica.

// Reporte DGA listo para enviar a la autoridad. Las 3 métricas pueden ser null
// si la telemetría del momento no incluía el sensor (se reporta como dato faltante).
export interface DgaReport {
  sitioId: string;
  obra: string | null;
  timestamp: Date;
  nivelFreatico: number | null; // metros
  caudal: number | null; // L/s
  totalizado: number | null; // m³ acumulado
  estatus?: 'pendiente' | 'enviado' | 'rechazado';
  comprobante?: string | null;
}

// Variante para filas leídas de la DB; añade el instante en que se persistió.
export interface DgaReportRow extends DgaReport {
  receivedAt?: Date;
}

// Filtros para listar reportes por sitio (endpoint paginado).
export interface ReportQuery {
  sitioId: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}
