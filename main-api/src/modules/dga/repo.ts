/**
 * Repositorio DGA — modelo redesign 2026-05-17:
 *   - dga_informante: pool global de credenciales SNIA por RUT.
 *   - pozo_config.dga_*: config de envío por pozo (activo/transport/caudal_max
 *     /periodicidad/fecha_inicio/hora_inicio/informante_rut/retry/etc).
 *   - dato_dga: PK (site_id, ts). Sin id_dgauser.
 *   - dga_send_audit: PK por id, FK lógica (site_id, ts).
 */
import { query } from '../../config/dbHelpers';
import type { Periodicidad } from './schema';

export type DgaTransport = 'off' | 'shadow' | 'rest';

// ============================================================================
// dga_informante (pool global)
// ============================================================================

export interface DgaInformanteRow {
  rut: string;
  clave_informante: string;
  referencia: string | null;
  created_at: string;
  updated_at: string;
}

const INFORMANTE_COLS =
  'rut, clave_informante, referencia, created_at, updated_at';

export async function listInformantes(): Promise<DgaInformanteRow[]> {
  const r = await query<DgaInformanteRow>(
    `SELECT ${INFORMANTE_COLS} FROM dga_informante ORDER BY referencia, rut`,
    [],
    { name: 'dga__list_informantes' },
  );
  return r.rows;
}

export async function findInformanteByRut(rut: string): Promise<DgaInformanteRow | null> {
  const r = await query<DgaInformanteRow>(
    `SELECT ${INFORMANTE_COLS} FROM dga_informante WHERE rut = $1`,
    [rut],
    { name: 'dga__find_informante' },
  );
  return r.rows[0] ?? null;
}

/**
 * Upsert informante. Si el RUT ya existe, actualiza clave + referencia.
 * Caller pasa la clave ya cifrada (ver crypto.ts).
 */
export async function upsertInformante(input: {
  rut: string;
  clave_cifrada: string;
  referencia: string | null;
}): Promise<DgaInformanteRow> {
  const r = await query<DgaInformanteRow>(
    `INSERT INTO dga_informante (rut, clave_informante, referencia)
     VALUES ($1, $2, $3)
     ON CONFLICT (rut) DO UPDATE SET
       clave_informante = EXCLUDED.clave_informante,
       referencia       = COALESCE(EXCLUDED.referencia, dga_informante.referencia),
       updated_at       = NOW()
     RETURNING ${INFORMANTE_COLS}`,
    [input.rut, input.clave_cifrada, input.referencia],
    { name: 'dga__upsert_informante' },
  );
  const row = r.rows[0];
  if (!row) throw new Error('UPSERT dga_informante no devolvió fila');
  return row;
}

export async function deleteInformante(rut: string): Promise<boolean> {
  const r = await query(
    `DELETE FROM dga_informante WHERE rut = $1`,
    [rut],
    { name: 'dga__delete_informante' },
  );
  return (r.rowCount ?? 0) > 0;
}

// ============================================================================
// pozo_config.dga_* (config envío por pozo)
// ============================================================================

export interface PozoDgaConfigRow {
  sitio_id: string;
  obra_dga: string | null;
  dga_activo: boolean;
  dga_transport: DgaTransport;
  dga_caudal_max_lps: string | null;
  dga_caudal_tolerance_pct: string;
  dga_periodicidad: Periodicidad | null;
  dga_fecha_inicio: string | null;
  dga_hora_inicio: string | null;
  dga_informante_rut: string | null;
  dga_max_retry_attempts: number;
  dga_auto_accept_fallback_hours: number | null;
  dga_last_run_at: string | null;
}

const POZO_DGA_COLS =
  'sitio_id, obra_dga, ' +
  'dga_activo, dga_transport, dga_caudal_max_lps, dga_caudal_tolerance_pct, ' +
  "to_char(dga_fecha_inicio,'YYYY-MM-DD') AS dga_fecha_inicio, " +
  "to_char(dga_hora_inicio,'HH24:MI:SS') AS dga_hora_inicio, " +
  'dga_periodicidad, dga_informante_rut, dga_max_retry_attempts, ' +
  'dga_auto_accept_fallback_hours, dga_last_run_at';

export async function getPozoDgaConfig(siteId: string): Promise<PozoDgaConfigRow | null> {
  const r = await query<PozoDgaConfigRow>(
    `SELECT ${POZO_DGA_COLS} FROM pozo_config WHERE sitio_id = $1`,
    [siteId],
    { name: 'dga__get_pozo_dga_config' },
  );
  return r.rows[0] ?? null;
}

/**
 * Lista pozos con DGA activo, para los workers de fill/submission.
 * Solo retorna pozos con `dga_activo=true`. Filtros de transport los
 * aplica el caller (submission filtra adicionalmente por dga_transport='rest').
 */
export async function listPozosDgaActivos(): Promise<PozoDgaConfigRow[]> {
  const r = await query<PozoDgaConfigRow>(
    `SELECT ${POZO_DGA_COLS} FROM pozo_config WHERE dga_activo = TRUE`,
    [],
    { name: 'dga__list_pozos_activos' },
  );
  return r.rows;
}

/**
 * Patch parcial de los campos DGA del pozo. Solo actualiza los campos
 * presentes en `input` (undefined = no tocar). Devuelve la fila completa
 * actualizada o null si el sitio no tiene pozo_config (debe existir el
 * UPSERT primero via PATCH /api/companies/sites/:id).
 */
export async function patchPozoDgaConfig(
  siteId: string,
  input: {
    dga_activo?: boolean | undefined;
    dga_transport?: DgaTransport | undefined;
    dga_caudal_max_lps?: number | null | undefined;
    dga_caudal_tolerance_pct?: number | undefined;
    dga_periodicidad?: Periodicidad | null | undefined;
    dga_fecha_inicio?: string | null | undefined;
    dga_hora_inicio?: string | null | undefined;
    dga_informante_rut?: string | null | undefined;
    dga_max_retry_attempts?: number | undefined;
    dga_auto_accept_fallback_hours?: number | null | undefined;
  },
): Promise<PozoDgaConfigRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [siteId];
  let i = 2;

  const addSet = (col: string, val: unknown): void => {
    sets.push(`${col} = $${i++}`);
    values.push(val);
  };

  if (input.dga_activo !== undefined) addSet('dga_activo', input.dga_activo);
  if (input.dga_transport !== undefined) addSet('dga_transport', input.dga_transport);
  if (input.dga_caudal_max_lps !== undefined) addSet('dga_caudal_max_lps', input.dga_caudal_max_lps);
  if (input.dga_caudal_tolerance_pct !== undefined)
    addSet('dga_caudal_tolerance_pct', input.dga_caudal_tolerance_pct);
  if (input.dga_periodicidad !== undefined) addSet('dga_periodicidad', input.dga_periodicidad);
  if (input.dga_fecha_inicio !== undefined) addSet('dga_fecha_inicio', input.dga_fecha_inicio);
  if (input.dga_hora_inicio !== undefined) addSet('dga_hora_inicio', input.dga_hora_inicio);
  if (input.dga_informante_rut !== undefined)
    addSet('dga_informante_rut', input.dga_informante_rut);
  if (input.dga_max_retry_attempts !== undefined)
    addSet('dga_max_retry_attempts', input.dga_max_retry_attempts);
  if (input.dga_auto_accept_fallback_hours !== undefined)
    addSet('dga_auto_accept_fallback_hours', input.dga_auto_accept_fallback_hours);

  if (sets.length === 0) return getPozoDgaConfig(siteId);

  sets.push(`updated_at = NOW()`);

  const r = await query<PozoDgaConfigRow>(
    `UPDATE pozo_config SET ${sets.join(', ')}
       WHERE sitio_id = $1
   RETURNING ${POZO_DGA_COLS}`,
    values,
    { name: 'dga__patch_pozo_dga_config' },
  );
  return r.rows[0] ?? null;
}

export async function markPozoDgaLastRun(siteId: string, runAt: string): Promise<void> {
  await query(
    `UPDATE pozo_config SET dga_last_run_at = $2, updated_at = NOW()
      WHERE sitio_id = $1`,
    [siteId, runAt],
    { name: 'dga__mark_last_run' },
  );
}

// ============================================================================
// dato_dga (slots de medición)
// ============================================================================

export interface VacioSlotRow {
  site_id: string;
  ts: string;
}

export interface ValidationWarning {
  code: string;
  raw?: number | null;
  suggested?: number | null;
  limit?: number;
  tolerance_pct?: number;
  reason?: string;
  [k: string]: unknown;
}

export interface DatoDgaRow {
  site_id: string;
  obra: string;
  ts: string;
  fecha: string;
  hora: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  estatus: string;
  comprobante: string | null;
}

export async function listVacioSlotsForSite(
  siteId: string,
  limit: number,
): Promise<VacioSlotRow[]> {
  const r = await query<VacioSlotRow>(
    `SELECT site_id, ts FROM dato_dga
      WHERE site_id = $1
        AND estatus = 'vacio'
        AND ts <= now()
      ORDER BY ts ASC
      LIMIT $2`,
    [siteId, limit],
    { name: 'dga__list_vacio_slots' },
  );
  return r.rows;
}

export async function findLastValidTotalizador(
  siteId: string,
  beforeTs: string,
): Promise<number | null> {
  const r = await query<{ flujo_acumulado: string }>(
    `SELECT flujo_acumulado FROM dato_dga
      WHERE site_id = $1
        AND ts < $2
        AND flujo_acumulado IS NOT NULL
        AND flujo_acumulado > 0
      ORDER BY ts DESC
      LIMIT 1`,
    [siteId, beforeTs],
    { name: 'dga__last_valid_totalizador' },
  );
  const v = r.rows[0]?.flujo_acumulado;
  return v == null ? null : Number(v);
}

export async function transitionSlotToPendiente(input: {
  site_id: string;
  ts: string;
  caudal_instantaneo: number | null;
  flujo_acumulado: number | null;
  nivel_freatico: number | null;
}): Promise<boolean> {
  const r = await query(
    `UPDATE dato_dga
        SET estatus            = 'pendiente',
            caudal_instantaneo = $3,
            flujo_acumulado    = $4,
            nivel_freatico     = $5,
            validation_warnings = '[]'::jsonb,
            fail_reason        = NULL
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'vacio'`,
    [
      input.site_id,
      input.ts,
      input.caudal_instantaneo,
      input.flujo_acumulado,
      input.nivel_freatico,
    ],
    { name: 'dga__slot_to_pendiente' },
  );
  return (r.rowCount ?? 0) > 0;
}

export async function transitionSlotToRequiresReview(input: {
  site_id: string;
  ts: string;
  caudal_instantaneo: number | null;
  flujo_acumulado: number | null;
  nivel_freatico: number | null;
  validation_warnings: ValidationWarning[];
  fail_reason: string;
}): Promise<boolean> {
  const r = await query(
    `UPDATE dato_dga
        SET estatus             = 'requires_review',
            caudal_instantaneo  = $3,
            flujo_acumulado     = $4,
            nivel_freatico      = $5,
            validation_warnings = $6::jsonb,
            fail_reason         = $7
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'vacio'`,
    [
      input.site_id,
      input.ts,
      input.caudal_instantaneo,
      input.flujo_acumulado,
      input.nivel_freatico,
      JSON.stringify(input.validation_warnings),
      input.fail_reason,
    ],
    { name: 'dga__slot_to_requires_review' },
  );
  return (r.rowCount ?? 0) > 0;
}

// ============================================================================
// Submission queue
// ============================================================================

export interface PendingSubmissionRow {
  site_id: string;
  ts: string;
  obra: string;
  codigo_obra: string | null;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  attempts: number;
  rut_informante: string;
  clave_informante: string;
  max_retry_attempts: number;
}

/**
 * Lista slots pendientes listos para envío (1 por pozo / ciclo).
 * Filtra: pozo dga_activo + dga_transport='rest' + informante asociado.
 *
 * §6.1 — 1 slot por pozo por ciclo (5-min separación natural).
 * §6.2 — Respeta next_retry_at (24h tras rechazo).
 */
export async function listPendingForSubmission(limit: number): Promise<PendingSubmissionRow[]> {
  const r = await query<PendingSubmissionRow>(
    `WITH ranked AS (
       SELECT
         d.site_id,
         d.ts,
         d.obra,
         pc.obra_dga                  AS codigo_obra,
         d.caudal_instantaneo,
         d.flujo_acumulado,
         d.nivel_freatico,
         d.intentos                   AS attempts,
         inf.rut                      AS rut_informante,
         inf.clave_informante,
         pc.dga_max_retry_attempts    AS max_retry_attempts,
         ROW_NUMBER() OVER (PARTITION BY d.site_id ORDER BY d.ts ASC) AS rn
       FROM dato_dga d
       JOIN pozo_config pc      ON pc.sitio_id = d.site_id
       LEFT JOIN dga_informante inf ON inf.rut = pc.dga_informante_rut
       WHERE d.estatus         = 'pendiente'
         AND (d.next_retry_at IS NULL OR d.next_retry_at <= now())
         AND pc.dga_activo     = TRUE
         AND pc.dga_transport  = 'rest'
         AND pc.dga_informante_rut IS NOT NULL
     )
     SELECT site_id, ts, obra, codigo_obra, caudal_instantaneo, flujo_acumulado,
            nivel_freatico, attempts, rut_informante, clave_informante,
            max_retry_attempts
       FROM ranked
      WHERE rn = 1
      ORDER BY ts ASC
      LIMIT $1`,
    [limit],
    { name: 'dga__list_pending_for_submission' },
  );
  return r.rows;
}

export async function lockSlotForSending(siteId: string, ts: string): Promise<boolean> {
  const r = await query(
    `UPDATE dato_dga
        SET estatus           = 'enviando',
            ultimo_intento_at = now()
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'pendiente'`,
    [siteId, ts],
    { name: 'dga__lock_for_sending' },
  );
  return (r.rowCount ?? 0) > 0;
}

export async function markSlotEnviado(input: {
  site_id: string;
  ts: string;
  comprobante: string;
}): Promise<void> {
  await query(
    `UPDATE dato_dga
        SET estatus       = 'enviado',
            comprobante   = $3,
            intentos      = intentos + 1,
            next_retry_at = NULL,
            fail_reason   = NULL
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'enviando'`,
    [input.site_id, input.ts, input.comprobante],
    { name: 'dga__mark_enviado' },
  );
}

export async function markSlotRechazado(input: {
  site_id: string;
  ts: string;
  fail_reason: string;
  max_retry_attempts: number;
}): Promise<{ terminal: boolean; attempts: number }> {
  const r = await query<{ intentos: number; estatus: string }>(
    `UPDATE dato_dga
        SET intentos      = intentos + 1,
            fail_reason   = $3,
            next_retry_at = now() + interval '24 hours',
            estatus       = CASE
                              WHEN intentos + 1 >= $4 THEN 'fallido'
                              ELSE 'pendiente'
                            END
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'enviando'
      RETURNING intentos, estatus`,
    [input.site_id, input.ts, input.fail_reason, input.max_retry_attempts],
    { name: 'dga__mark_rechazado' },
  );
  const row = r.rows[0];
  return {
    terminal: row?.estatus === 'fallido',
    attempts: row?.intentos ?? 0,
  };
}

// ============================================================================
// dga_send_audit (append-only)
// ============================================================================

export async function insertSendAudit(input: {
  site_id: string;
  ts: string;
  attempt_n: number;
  transport: 'rest' | 'soap' | 'legacy-import';
  http_status: number | null;
  dga_status_code: string | null;
  dga_message: string | null;
  api_n_comprobante: string | null;
  api_status_description: string | null;
  request_payload: unknown;
  raw_response: unknown;
  duration_ms: number;
  /** Override de sent_at; default now(). Solo usar para import legacy. */
  sent_at?: string;
}): Promise<void> {
  await query(
    `INSERT INTO dga_send_audit (
       site_id, ts, attempt_n, transport, http_status,
       dga_status_code, dga_message, api_n_comprobante, api_status_description,
       request_payload, raw_response, sent_at, duration_ms
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
              COALESCE($13::timestamptz, now()), $12)`,
    [
      input.site_id,
      input.ts,
      input.attempt_n,
      input.transport,
      input.http_status,
      input.dga_status_code,
      input.dga_message,
      input.api_n_comprobante,
      input.api_status_description,
      JSON.stringify(input.request_payload ?? null),
      JSON.stringify(input.raw_response ?? null),
      input.duration_ms,
      input.sent_at ?? null,
    ],
    { name: 'dga__insert_send_audit' },
  );
}

// ============================================================================
// Importador legacy CSV
// ============================================================================

/**
 * Resuelve el sitio asociado a un código de obra (OB-XXXX-XXX) via
 * pozo_config.obra_dga.
 */
export async function findSiteByCodigoObra(codigoObra: string): Promise<string | null> {
  const r = await query<{ sitio_id: string }>(
    `SELECT sitio_id FROM pozo_config WHERE obra_dga = $1 LIMIT 1`,
    [codigoObra],
    { name: 'dga__site_by_codigo_obra' },
  );
  return r.rows[0]?.sitio_id ?? null;
}

export async function upsertDatoDgaFromLegacy(input: {
  site_id: string;
  ts: string;
  obra: string;
  caudal_instantaneo: number | null;
  flujo_acumulado_truncado: number | null;
  totalizator_raw_legacy: number | null;
  nivel_freatico: number | null;
  comprobante: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO dato_dga (
       site_id, obra, ts,
       caudal_instantaneo, flujo_acumulado, totalizator_raw_legacy, nivel_freatico,
       estatus, comprobante, intentos, validation_warnings, fail_reason, next_retry_at
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       'enviado', $8, 1, '[]'::jsonb, NULL, NULL
     )
     ON CONFLICT (site_id, ts) DO UPDATE SET
       obra                    = EXCLUDED.obra,
       caudal_instantaneo      = EXCLUDED.caudal_instantaneo,
       flujo_acumulado         = EXCLUDED.flujo_acumulado,
       totalizator_raw_legacy  = EXCLUDED.totalizator_raw_legacy,
       nivel_freatico          = EXCLUDED.nivel_freatico,
       estatus                 = 'enviado',
       comprobante             = EXCLUDED.comprobante,
       validation_warnings     = '[]'::jsonb,
       fail_reason             = NULL,
       next_retry_at           = NULL`,
    [
      input.site_id,
      input.obra,
      input.ts,
      input.caudal_instantaneo,
      input.flujo_acumulado_truncado,
      input.totalizator_raw_legacy,
      input.nivel_freatico,
      input.comprobante,
    ],
    { name: 'dga__upsert_legacy_dato' },
  );
}

// ============================================================================
// Review queue
// ============================================================================

export interface ReviewSlotRow {
  site_id: string;
  ts: string;
  obra: string;
  codigo_obra: string | null;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  validation_warnings: ValidationWarning[];
  fail_reason: string | null;
  referencia_informante: string | null;
}

export async function listSlotsRequiresReview(input: {
  site_id?: string | undefined;
  limit?: number | undefined;
}): Promise<ReviewSlotRow[]> {
  const limit = Math.min(input.limit ?? 100, 500);
  const args: unknown[] = [limit];
  let where = `d.estatus = 'requires_review'`;
  if (input.site_id) {
    args.push(input.site_id);
    where += ` AND d.site_id = $${args.length}`;
  }
  const r = await query<ReviewSlotRow>(
    `SELECT
        d.site_id,
        d.ts,
        d.obra,
        pc.obra_dga                AS codigo_obra,
        d.caudal_instantaneo,
        d.flujo_acumulado,
        d.nivel_freatico,
        d.validation_warnings,
        d.fail_reason,
        inf.referencia             AS referencia_informante
      FROM dato_dga d
      JOIN pozo_config pc       ON pc.sitio_id = d.site_id
      LEFT JOIN dga_informante inf ON inf.rut = pc.dga_informante_rut
     WHERE ${where}
     ORDER BY d.ts DESC
     LIMIT $1`,
    args,
    { name: 'dga__list_review_queue' },
  );
  return r.rows;
}

export async function acceptReviewSlotWithValues(input: {
  site_id: string;
  ts: string;
  caudal_instantaneo: number | null;
  flujo_acumulado: number | null;
  nivel_freatico: number | null;
  admin_note: string;
}): Promise<boolean> {
  const r = await query(
    `UPDATE dato_dga
        SET estatus             = 'pendiente',
            caudal_instantaneo  = $3,
            flujo_acumulado     = $4,
            nivel_freatico      = $5,
            validation_warnings = COALESCE(validation_warnings, '[]'::jsonb)
                                  || jsonb_build_array(jsonb_build_object(
                                       'code', 'admin_override',
                                       'reason', $6::text,
                                       'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                                     )),
            fail_reason         = NULL,
            next_retry_at       = NULL,
            intentos            = 0
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'requires_review'`,
    [
      input.site_id,
      input.ts,
      input.caudal_instantaneo,
      input.flujo_acumulado,
      input.nivel_freatico,
      input.admin_note,
    ],
    { name: 'dga__accept_review_slot' },
  );
  return (r.rowCount ?? 0) > 0;
}

export async function markReviewSlotFailedManual(input: {
  site_id: string;
  ts: string;
  admin_note: string;
}): Promise<boolean> {
  const r = await query(
    `UPDATE dato_dga
        SET estatus             = 'fallido',
            fail_reason         = $3,
            validation_warnings = COALESCE(validation_warnings, '[]'::jsonb)
                                  || jsonb_build_array(jsonb_build_object(
                                       'code', 'admin_discarded',
                                       'reason', $3::text,
                                       'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                                     ))
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'requires_review'`,
    [input.site_id, input.ts, input.admin_note],
    { name: 'dga__mark_review_failed' },
  );
  return (r.rowCount ?? 0) > 0;
}

// ============================================================================
// Reconciler queries
// ============================================================================

export interface StuckEnviandoRow {
  site_id: string;
  ts: string;
}
export async function listStuckEnviando(thresholdMinutes: number): Promise<StuckEnviandoRow[]> {
  const r = await query<StuckEnviandoRow>(
    `SELECT site_id, ts
       FROM dato_dga
      WHERE estatus = 'enviando'
        AND (ultimo_intento_at IS NULL
             OR ultimo_intento_at < now() - ($1 || ' minutes')::interval)
      ORDER BY ts ASC
      LIMIT 200`,
    [String(thresholdMinutes)],
    { name: 'dga__list_stuck_enviando' },
  );
  return r.rows;
}

export async function unlockStuckEnviando(siteId: string, ts: string): Promise<void> {
  await query(
    `UPDATE dato_dga
        SET estatus = 'pendiente'
      WHERE site_id = $1
        AND ts      = $2
        AND estatus = 'enviando'`,
    [siteId, ts],
    { name: 'dga__unlock_stuck' },
  );
}

export interface DriftEnviadoRow {
  site_id: string;
  ts: string;
  api_n_comprobante: string;
  current_estatus: string;
}
export async function listDriftAuditEnviadoVsEstado(): Promise<DriftEnviadoRow[]> {
  const r = await query<DriftEnviadoRow>(
    `SELECT DISTINCT ON (a.site_id, a.ts)
            a.site_id,
            a.ts,
            a.api_n_comprobante,
            d.estatus AS current_estatus
       FROM dga_send_audit a
       JOIN dato_dga d USING (site_id, ts)
      WHERE a.dga_status_code  = '00'
        AND a.api_n_comprobante IS NOT NULL
        AND d.estatus          <> 'enviado'
      ORDER BY a.site_id, a.ts, a.sent_at DESC
      LIMIT 500`,
    [],
    { name: 'dga__drift_audit_enviado' },
  );
  return r.rows;
}

export async function reconcileMarkEnviado(input: {
  site_id: string;
  ts: string;
  comprobante: string;
}): Promise<void> {
  await query(
    `UPDATE dato_dga
        SET estatus       = 'enviado',
            comprobante   = $3,
            next_retry_at = NULL,
            fail_reason   = NULL
      WHERE site_id = $1
        AND ts      = $2`,
    [input.site_id, input.ts, input.comprobante],
    { name: 'dga__reconcile_mark_enviado' },
  );
}

export interface EnviadoSinAuditRow {
  site_id: string;
  ts: string;
  comprobante: string | null;
}
export async function listEnviadoSinAudit(): Promise<EnviadoSinAuditRow[]> {
  const r = await query<EnviadoSinAuditRow>(
    `SELECT d.site_id, d.ts, d.comprobante
       FROM dato_dga d
      WHERE d.estatus = 'enviado'
        AND NOT EXISTS (
              SELECT 1 FROM dga_send_audit a
               WHERE a.site_id = d.site_id
                 AND a.ts      = d.ts
            )
      ORDER BY d.ts DESC
      LIMIT 100`,
    [],
    { name: 'dga__enviado_sin_audit' },
  );
  return r.rows;
}

export interface DoubleSendRow {
  site_id: string;
  ts: string;
  ok_count: number;
}
export async function listDoubleSubmission(): Promise<DoubleSendRow[]> {
  const r = await query<DoubleSendRow>(
    `SELECT site_id, ts, COUNT(*)::int AS ok_count
       FROM dga_send_audit
      WHERE dga_status_code = '00'
      GROUP BY site_id, ts
     HAVING COUNT(*) > 1
      ORDER BY site_id, ts
      LIMIT 100`,
    [],
    { name: 'dga__double_submission' },
  );
  return r.rows;
}

// ============================================================================
// Lectura de mediciones por sitio (Detalle de Registros)
// ============================================================================

/**
 * Última medición exitosamente enviada a SNIA para un sitio. Independiente
 * del filtro de fecha del UI — siempre devuelve el MAX(ts) global.
 * Devuelve null si nunca hubo envíos.
 */
export interface UltimoEnvioRow {
  ts: string;
  comprobante: string | null;
}
export async function getUltimoEnvioBySite(siteId: string): Promise<UltimoEnvioRow | null> {
  const r = await query<UltimoEnvioRow>(
    `SELECT ts, comprobante
       FROM dato_dga
      WHERE site_id = $1
        AND estatus = 'enviado'
      ORDER BY ts DESC
      LIMIT 1`,
    [siteId],
    { name: 'dga__ultimo_envio_by_site' },
  );
  return r.rows[0] ?? null;
}

export async function queryDatoDgaBySite(
  siteId: string,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const r = await query<DatoDgaRow>(
    `SELECT site_id, obra, ts,
            to_char(fecha, 'YYYY-MM-DD')      AS fecha,
            to_char(hora,  'HH24:MI:SS')      AS hora,
            caudal_instantaneo, flujo_acumulado, nivel_freatico,
            estatus, comprobante
       FROM dato_dga
      WHERE site_id = $1
        AND ts >= $2 AND ts < $3
      ORDER BY ts ASC`,
    [siteId, desde, hasta],
    { name: 'dga__query_dato_by_site' },
  );
  return r.rows;
}
