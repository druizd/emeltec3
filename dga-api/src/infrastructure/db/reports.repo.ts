import { pool } from './pool';
import type { DgaReport, ReportQuery } from '../../domain/reports/report.types';
import { NotFoundError } from '../../shared/errors';

export async function insertReport(report: DgaReport): Promise<void> {
  const { rowCount } = await pool.query(
    `INSERT INTO dato_dga (id_dgauser, obra, ts, caudal_instantaneo, flujo_acumulado, nivel_freatico)
     SELECT du.id_dgauser,
            COALESCE(pc.obra_dga, ''),
            $2::TIMESTAMPTZ,
            $3,
            $4,
            $5
       FROM dga_user du
       LEFT JOIN pozo_config pc ON pc.sitio_id = du.site_id
      WHERE du.site_id = $1 AND du.activo = TRUE
      LIMIT 1
     ON CONFLICT (id_dgauser, ts) DO NOTHING`,
    [report.sitioId, report.timestamp, report.caudal, report.totalizado, report.nivelFreatico],
  );
  if (!rowCount)
    throw new NotFoundError(`dga_user activo no encontrado para sitio ${report.sitioId}`);
}

export async function findBySite(q: ReportQuery): Promise<{ items: DgaReport[]; total: number }> {
  const params: unknown[] = [q.sitioId, q.from ?? null, q.to ?? null];
  const where = `u.site_id = $1
    AND ($2::TIMESTAMPTZ IS NULL OR d.ts >= $2)
    AND ($3::TIMESTAMPTZ IS NULL OR d.ts <= $3)`;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS total
       FROM dato_dga d
       JOIN dga_user u USING (id_dgauser)
      WHERE ${where}`,
    params,
  );
  const total = Number(countRows[0].total);

  const offset = (q.page - 1) * q.pageSize;
  const { rows } = await pool.query(
    `SELECT d.ts,
            u.site_id,
            d.obra,
            d.nivel_freatico,
            d.caudal_instantaneo,
            d.flujo_acumulado
       FROM dato_dga d
       JOIN dga_user u USING (id_dgauser)
      WHERE ${where}
      ORDER BY d.ts DESC
      LIMIT $4 OFFSET $5`,
    [...params, q.pageSize, offset],
  );

  const items: DgaReport[] = rows.map((r) => ({
    sitioId: r.site_id,
    obra: r.obra ?? null,
    timestamp: new Date(r.ts),
    nivelFreatico: r.nivel_freatico == null ? null : Number(r.nivel_freatico),
    caudal: r.caudal_instantaneo == null ? null : Number(r.caudal_instantaneo),
    totalizado: r.flujo_acumulado == null ? null : Number(r.flujo_acumulado),
  }));

  return { items, total };
}
