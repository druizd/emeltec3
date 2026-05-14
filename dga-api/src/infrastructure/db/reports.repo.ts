import { pool } from './pool';
import type { DgaReport, ReportQuery } from '../../domain/reports/report.types';
import type { PendingSubmission } from '../../domain/submission/pendingSubmission.types';
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

// Trae filas pendientes o rechazadas listas para (re)intentar envío a MIA-DGA.
// Incluye credenciales del informante desde dga_user para armar DgaSubmissionPayload.
// Retry logic: envía si nunca se intentó (intentos=0) o si el último intento fue hace más de 23h
// (conforme spec DGA enero 2025: reenvío al día siguiente si falla).
export async function findPending(limit = 50): Promise<PendingSubmission[]> {
  const { rows } = await pool.query(
    `SELECT d.id_dgauser,
            d.ts,
            d.obra,
            d.nivel_freatico,
            d.caudal_instantaneo,
            d.flujo_acumulado,
            d.intentos,
            u.site_id,
            u.rut_informante,
            u.clave_informante
       FROM dato_dga d
       JOIN dga_user u USING (id_dgauser)
      WHERE d.estatus != 'enviado'
        AND (d.ultimo_intento_at IS NULL
             OR d.ultimo_intento_at < NOW() - INTERVAL '23 hours')
      ORDER BY d.ts ASC
      LIMIT $1`,
    [limit],
  );

  return rows.map((r) => ({
    idDgauser: Number(r.id_dgauser),
    obra: r.obra as string,
    rutInformante: r.rut_informante as string,
    claveInformante: r.clave_informante as string,
    report: {
      sitioId: r.site_id as string,
      obra: r.obra as string,
      timestamp: new Date(r.ts as string),
      nivelFreatico: r.nivel_freatico == null ? null : Number(r.nivel_freatico),
      caudal: r.caudal_instantaneo == null ? null : Number(r.caudal_instantaneo),
      totalizado: r.flujo_acumulado == null ? null : Number(r.flujo_acumulado),
    },
    intentos: Number(r.intentos),
  }));
}

export async function updateSubmissionResult(args: {
  idDgauser: number;
  ts: Date;
  estatus: 'enviado' | 'rechazado';
  comprobante?: string;
}): Promise<void> {
  await pool.query(
    `UPDATE dato_dga
        SET estatus           = $3,
            comprobante       = $4,
            ultimo_intento_at = NOW(),
            intentos          = intentos + 1
      WHERE id_dgauser = $1
        AND ts = $2`,
    [args.idDgauser, args.ts, args.estatus, args.comprobante ?? null],
  );
}
