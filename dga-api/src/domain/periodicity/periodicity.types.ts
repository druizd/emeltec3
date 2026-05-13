// Modelos para la periodicidad de envío: cada cuánto debe reportar un sitio a DGA.
// La DGA exige cadencias distintas por tipo de obra (ej. cada 1h, cada 1día, cada 1mes).

export type PeriodicityUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

// Configuración de periodicidad de un sitio.
// `every=1, unit='hour'` → debe reportar cada hora.
// `lastReportedAt=null` → nunca ha reportado, está pendiente.
export interface Periodicity {
  sitioId: string;
  every: number;
  unit: PeriodicityUnit;
  lastReportedAt: Date | null;
}

// Sitio que cumple condición de "está vencido y debe reportar ahora".
// Lo devuelve `selectDueSites` y lo consume el worker de ingestión.
export interface PeriodicityCandidate {
  sitioId: string;
  dueAt: Date;
}
