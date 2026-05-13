import type { Periodicity } from '../../domain/periodicity/periodicity.types';

// TODO(bloqueado): la tabla de periodicidad la define el compañero.
//   Cuando confirme nombre + columnas, completar las queries.
//   Estructura tentativa: tabla `dga_periodicidad` con
//     (sitio_id VARCHAR PK FK→sitio.id, every_n INT, unit VARCHAR, last_reported_at TIMESTAMPTZ)

const TABLE = process.env.DGA_PERIODICITY_TABLE || 'dga_periodicidad';

export async function listAll(): Promise<Periodicity[]> {
  void TABLE;
  throw new Error('NOT_IMPLEMENTED: periodicity.repo.listAll — falta nombre real de tabla');
}

export async function markReported(_sitioId: string, _reportedAt: Date): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: periodicity.repo.markReported — falta nombre real de tabla');
}
