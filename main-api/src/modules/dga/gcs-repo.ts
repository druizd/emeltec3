/**
 * Repositorio del export DGA → GCS.
 *
 * Fuente de verdad de VALORES: dga_send_audit.request_payload (medición tal
 * cual se ENVIÓ a SNIA en ese intento), no dato_dga — que es mutable y podría
 * reflejar un reenvío posterior. Esto hace el Parquet auditable contra lo que
 * efectivamente recibió DGA. Solo se consideran filas con dga_status_code IS
 * NOT NULL (= SNIA respondió; enviado o rechazado, nunca sin respuesta).
 *
 * Metadatos de contexto (planta, nombre_sensor) salen de la config actual del
 * sitio — no varían por intento.
 */
import { query } from '../../config/dbHelpers';
import type { ExportableSend } from './gcs-parquet-builder';

interface ExportableSendDbRow {
  audit_id: string; // BIGINT → string en node-pg
  site_id: string;
  ts: string;
  sent_at: string;
  dga_status_code: string | null;
  comprobante: string | null;
  dga_message: string | null;
  planta: string;
  centro_de_obra: string | null;
  nombre_sensor: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
}

/** '' (nivel vacío que SNIA acepta) se normaliza a null para el Parquet. */
function emptyToNull(v: string | null): string | null {
  return v == null || v === '' ? null : v;
}

/**
 * Envíos DGA respondidos, de sitios habilitados (dga_gcs_export=TRUE), aún no
 * exportados a GCS. Orden cronológico por respuesta. `limit` acota el ciclo.
 */
export async function listExportableSends(limit: number): Promise<ExportableSend[]> {
  const r = await query<ExportableSendDbRow>(
    `SELECT
        a.id                                                              AS audit_id,
        a.site_id,
        a.ts,
        a.sent_at,
        a.dga_status_code,
        a.api_n_comprobante                                               AS comprobante,
        a.dga_message,
        se.nombre                                                         AS planta,
        COALESCE(a.request_payload->'_headers'->>'codigoObra', pc.obra_dga) AS centro_de_obra,
        s.id_serial                                                       AS nombre_sensor,
        a.request_payload->'medicionSubterranea'->>'caudal'              AS caudal_instantaneo,
        a.request_payload->'medicionSubterranea'->>'totalizador'         AS flujo_acumulado,
        a.request_payload->'medicionSubterranea'->>'nivelFreaticoDelPozo' AS nivel_freatico
       FROM dga_send_audit a
       JOIN sitio s        ON s.id = a.site_id
       JOIN sub_empresa se ON se.id = s.sub_empresa_id
       JOIN pozo_config pc ON pc.sitio_id = a.site_id
      WHERE a.dga_status_code IS NOT NULL
        AND pc.dga_gcs_export = TRUE
        AND NOT EXISTS (
              SELECT 1 FROM dga_gcs_export_log l WHERE l.audit_id = a.id
            )
      ORDER BY a.sent_at ASC
      LIMIT $1`,
    [limit],
    { name: 'dga__list_exportable_sends' },
  );
  return r.rows.map((row) => ({
    audit_id: Number(row.audit_id),
    site_id: row.site_id,
    ts: row.ts,
    sent_at: row.sent_at,
    dga_status_code: row.dga_status_code,
    comprobante: row.comprobante,
    dga_message: row.dga_message,
    planta: row.planta,
    centro_de_obra: row.centro_de_obra,
    nombre_sensor: row.nombre_sensor,
    caudal_instantaneo: emptyToNull(row.caudal_instantaneo),
    flujo_acumulado: emptyToNull(row.flujo_acumulado),
    nivel_freatico: emptyToNull(row.nivel_freatico),
  }));
}

export interface GcsExportLogInput {
  audit_id: number;
  site_id: string;
  ts: string;
  dga_status_code: string | null;
  comprobante: string | null;
  gcs_bucket: string;
  gcs_path: string;
  row_count: number;
  /** Acuse de GCS: version del objeto y checksum MD5 (prueba de entrega). */
  gcs_generation: string | null;
  gcs_md5: string | null;
}

/**
 * Registra un audit como exportado. ON CONFLICT (audit_id) DO NOTHING →
 * idempotente: si dos ciclos pisan el mismo audit, no duplica el ledger.
 */
export async function insertGcsExportLog(input: GcsExportLogInput): Promise<void> {
  await query(
    `INSERT INTO dga_gcs_export_log
       (audit_id, site_id, ts, dga_status_code, comprobante, gcs_bucket, gcs_path,
        row_count, gcs_generation, gcs_md5)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (audit_id) DO NOTHING`,
    [
      input.audit_id,
      input.site_id,
      input.ts,
      input.dga_status_code,
      input.comprobante,
      input.gcs_bucket,
      input.gcs_path,
      input.row_count,
      input.gcs_generation,
      input.gcs_md5,
    ],
    { name: 'dga__insert_gcs_export_log' },
  );
}
