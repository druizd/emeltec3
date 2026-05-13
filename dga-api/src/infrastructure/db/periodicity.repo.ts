import { pool } from './pool';
import type { Periodicity, PeriodicityUnit } from '../../domain/periodicity/periodicity.types';
import { NotFoundError } from '../../shared/errors';

type DgaPeriodicidad = 'minuto' | 'hora' | 'dia' | 'semana' | 'mes' | 'anio';

function mapPeriodicidad(p: DgaPeriodicidad): { every: number; unit: PeriodicityUnit } {
  switch (p) {
    case 'minuto':
      return { every: 1, unit: 'minute' };
    case 'hora':
      return { every: 1, unit: 'hour' };
    case 'dia':
      return { every: 1, unit: 'day' };
    case 'semana':
      return { every: 7, unit: 'day' };
    case 'mes':
      return { every: 1, unit: 'month' };
    case 'anio':
      return { every: 1, unit: 'year' };
  }
}

export async function listAll(): Promise<Periodicity[]> {
  const { rows } = await pool.query(
    `SELECT site_id, periodicidad, last_run_at
       FROM dga_user
      WHERE activo = TRUE`,
  );
  return rows.map((r) => {
    const { every, unit } = mapPeriodicidad(r.periodicidad as DgaPeriodicidad);
    return {
      sitioId: r.site_id,
      every,
      unit,
      lastReportedAt: r.last_run_at ? new Date(r.last_run_at) : null,
    };
  });
}

export async function markReported(sitioId: string, reportedAt: Date): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE dga_user
        SET last_run_at = $2, updated_at = NOW()
      WHERE site_id = $1 AND activo = TRUE`,
    [sitioId, reportedAt],
  );
  if (!rowCount) throw new NotFoundError(`dga_user activo no encontrado para sitio ${sitioId}`);
}
