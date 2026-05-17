/**
 * Repositorio DGA: dga_user (config informante) + dato_dga (mediciones procesadas).
 */
import { query } from '../../config/dbHelpers';
import type { Periodicidad } from './schema';

export type DgaTransport = 'off' | 'shadow' | 'rest';

export interface DgaUserRow {
  id_dgauser: string;
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  clave_informante: string;
  periodicidad: Periodicidad;
  fecha_inicio: string;
  hora_inicio: string;
  last_run_at: string | null;
  activo: boolean;
  transport: DgaTransport;
  caudal_max_lps: string | null;
  caudal_tolerance_pct: string;
  max_retry_attempts: number;
  auto_accept_fallback_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface VacioSlotRow {
  id_dgauser: string;
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
  id_dgauser: string;
  obra: string;
  ts: string;
  fecha: string;
  hora: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  /** Estado del slot. Usado por la tabla "Detalle de Registros" en water-detail. */
  estatus: string;
  /** numeroComprobante devuelto por SNIA si estatus='enviado'. */
  comprobante: string | null;
}

const USER_COLS =
  'id_dgauser, site_id, nombre_informante, rut_informante, clave_informante, periodicidad, ' +
  "to_char(fecha_inicio,'YYYY-MM-DD') AS fecha_inicio, " +
  "to_char(hora_inicio,'HH24:MI:SS') AS hora_inicio, " +
  'last_run_at, activo, transport, caudal_max_lps, caudal_tolerance_pct, ' +
  'max_retry_attempts, auto_accept_fallback_hours, created_at, updated_at';

export async function insertDgaUser(input: {
  site_id: string;
  nombre_informante: string;
  rut_informante: string;
  clave_cifrada: string;
  periodicidad: Periodicidad;
  fecha_inicio: string;
  hora_inicio: string;
}): Promise<DgaUserRow> {
  const r = await query<DgaUserRow>(
    `INSERT INTO dga_user
       (site_id, nombre_informante, rut_informante, clave_informante,
        periodicidad, fecha_inicio, hora_inicio)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${USER_COLS}`,
    [
      input.site_id,
      input.nombre_informante,
      input.rut_informante,
      input.clave_cifrada,
      input.periodicidad,
      input.fecha_inicio,
      input.hora_inicio,
    ],
    { name: 'dga__insert_user' },
  );
  const row = r.rows[0];
  if (!row) throw new Error('INSERT dga_user no devolvió fila');
  return row;
}

export async function listDgaUsersBySite(siteId: string): Promise<DgaUserRow[]> {
  const r = await query<DgaUserRow>(
    `SELECT ${USER_COLS}
       FROM dga_user
      WHERE site_id = $1
      ORDER BY created_at DESC`,
    [siteId],
    { name: 'dga__list_users_by_site' },
  );
  return r.rows;
}

export async function findDgaUserById(idDgaUser: number): Promise<DgaUserRow | null> {
  const r = await query<DgaUserRow>(
    `SELECT ${USER_COLS} FROM dga_user WHERE id_dgauser = $1`,
    [idDgaUser],
    { name: 'dga__find_user' },
  );
  return r.rows[0] ?? null;
}

export async function listActiveDgaUsers(): Promise<DgaUserRow[]> {
  const r = await query<DgaUserRow>(`SELECT ${USER_COLS} FROM dga_user WHERE activo = TRUE`, [], {
    name: 'dga__list_active',
  });
  return r.rows;
}

/**
 * Patch parcial de configuración DGA del informante. Solo se actualizan
 * los campos presentes en `input` (undefined = no tocar). Usado por el
 * endpoint admin del frontend para activar/pausar, cambiar transport o
 * cargar el caudal máximo.
 *
 * Devuelve el row actualizado o null si el id no existe.
 */
export async function updateDgaUserConfig(
  idDgaUser: number,
  input: {
    activo?: boolean | undefined;
    transport?: DgaTransport | undefined;
    caudal_max_lps?: number | null | undefined;
    caudal_tolerance_pct?: number | undefined;
  },
): Promise<DgaUserRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [idDgaUser];
  let i = 2;

  if (input.activo !== undefined) {
    sets.push(`activo = $${i++}`);
    values.push(input.activo);
  }
  if (input.transport !== undefined) {
    sets.push(`transport = $${i++}`);
    values.push(input.transport);
  }
  if (input.caudal_max_lps !== undefined) {
    sets.push(`caudal_max_lps = $${i++}`);
    values.push(input.caudal_max_lps);
  }
  if (input.caudal_tolerance_pct !== undefined) {
    sets.push(`caudal_tolerance_pct = $${i++}`);
    values.push(input.caudal_tolerance_pct);
  }

  if (sets.length === 0) {
    // Nada que actualizar: devolvemos el row tal cual.
    return findDgaUserById(idDgaUser);
  }

  sets.push(`updated_at = NOW()`);

  const r = await query<DgaUserRow>(
    `UPDATE dga_user SET ${sets.join(', ')}
       WHERE id_dgauser = $1
   RETURNING ${USER_COLS}`,
    values,
    { name: 'dga__update_user_config' },
  );
  return r.rows[0] ?? null;
}

export async function markDgaUserRun(idDgaUser: number, runAt: string): Promise<void> {
  await query(
    `UPDATE dga_user SET last_run_at = $2, updated_at = NOW() WHERE id_dgauser = $1`,
    [idDgaUser, runAt],
    { name: 'dga__mark_run' },
  );
}

export async function insertDatoDga(input: {
  id_dgauser: number;
  obra: string;
  ts: string;
  caudal_instantaneo: number | null;
  flujo_acumulado: number | null;
  nivel_freatico: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO dato_dga
       (id_dgauser, obra, ts, caudal_instantaneo, flujo_acumulado, nivel_freatico)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id_dgauser, ts) DO NOTHING`,
    [
      input.id_dgauser,
      input.obra,
      input.ts,
      input.caudal_instantaneo,
      input.flujo_acumulado,
      input.nivel_freatico,
    ],
    { name: 'dga__insert_dato' },
  );
}

/**
 * Lista slots en estatus='vacio' para un informante, ordenados ascendentemente.
 * Solo trae slots cuyo ts ya pasó (no procesar futuros). LIMIT cap para
 * no bloquear el worker en informantes con backlog masivo.
 */
export async function listVacioSlotsForUser(
  idDgaUser: number,
  limit: number,
): Promise<VacioSlotRow[]> {
  const r = await query<VacioSlotRow>(
    `SELECT id_dgauser, ts FROM dato_dga
      WHERE id_dgauser = $1
        AND estatus = 'vacio'
        AND ts <= now()
      ORDER BY ts ASC
      LIMIT $2`,
    [idDgaUser, limit],
    { name: 'dga__list_vacio_slots' },
  );
  return r.rows;
}

/**
 * Busca el último valor de totalizador > 0 reportado por este informante
 * antes del ts dado. Útil como sugerencia de fallback cuando el sensor
 * reporta 0 o NULL (glitch). NO se aplica automáticamente: solo se sugiere
 * en validation_warnings para que admin decida.
 */
export async function findLastValidTotalizador(
  idDgaUser: number,
  beforeTs: string,
): Promise<number | null> {
  const r = await query<{ flujo_acumulado: string }>(
    `SELECT flujo_acumulado FROM dato_dga
      WHERE id_dgauser = $1
        AND ts < $2
        AND flujo_acumulado IS NOT NULL
        AND flujo_acumulado > 0
      ORDER BY ts DESC
      LIMIT 1`,
    [idDgaUser, beforeTs],
    { name: 'dga__last_valid_totalizador' },
  );
  const v = r.rows[0]?.flujo_acumulado;
  return v == null ? null : Number(v);
}

/**
 * Transición vacio → pendiente: el slot pasó validación y queda listo para
 * envío. Filtra por estatus='vacio' en el WHERE para evitar pisar estados
 * intermedios si otro worker procesó el mismo slot (race condition).
 */
export async function transitionSlotToPendiente(input: {
  id_dgauser: number;
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
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'vacio'`,
    [
      input.id_dgauser,
      input.ts,
      input.caudal_instantaneo,
      input.flujo_acumulado,
      input.nivel_freatico,
    ],
    { name: 'dga__slot_to_pendiente' },
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Transición vacio → requires_review: validación detectó anomalías. Los
 * valores se guardan tal como vinieron (sin corrección automática) y las
 * razones quedan en validation_warnings para que admin decida en UI.
 */
export async function transitionSlotToRequiresReview(input: {
  id_dgauser: number;
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
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'vacio'`,
    [
      input.id_dgauser,
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

/**
 * Slot listo para enviar, con la metadata del informante y la obra DGA.
 * Combina dato_dga + dga_user + pozo_config para evitar round-trips.
 */
export interface PendingSubmissionRow {
  id_dgauser: string;
  ts: string;
  obra: string; // descripción/nombre (denormalizado en dato_dga)
  codigo_obra: string | null; // OB-XXXX-XXX desde pozo_config.obra_dga
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  attempts: number;
  rut_informante: string;
  clave_informante: string; // cifrada — el caller debe llamar decryptClave()
  max_retry_attempts: number;
}

/**
 * Selecciona slots pendientes listos para envío, máximo uno por informante
 * por ciclo. Aplica el gating: dga_user.activo=true y transport='rest'.
 *
 * Política Res 2170 §6.1: si hay backlog acumulado (2+ horas atrás), las
 * mediciones deben separarse ≥5min entre sí. Tomar 1 slot por informante
 * por ciclo (cycle=5min default) garantiza esa separación naturalmente.
 *
 * Política Res 2170 §6.2: tras rechazo, reenviar al día siguiente. Se
 * respeta vía next_retry_at: solo se considera el slot si su next_retry_at
 * ya pasó (o es NULL = primer intento).
 *
 * El cap total por ciclo (limit=50 default, Res 2170 §6) evita saturar
 * SNIA con catch-ups masivos.
 */
export async function listPendingForSubmission(limit: number): Promise<PendingSubmissionRow[]> {
  const r = await query<PendingSubmissionRow>(
    `WITH ranked AS (
       SELECT
         d.id_dgauser,
         d.ts,
         d.obra,
         pc.obra_dga                       AS codigo_obra,
         d.caudal_instantaneo,
         d.flujo_acumulado,
         d.nivel_freatico,
         d.intentos                        AS attempts,
         u.rut_informante,
         u.clave_informante,
         u.max_retry_attempts,
         ROW_NUMBER() OVER (PARTITION BY d.id_dgauser ORDER BY d.ts ASC) AS rn
       FROM dato_dga d
       JOIN dga_user u USING (id_dgauser)
       LEFT JOIN pozo_config pc ON pc.sitio_id = u.site_id
       WHERE d.estatus  = 'pendiente'
         AND (d.next_retry_at IS NULL OR d.next_retry_at <= now())
         AND u.activo   = TRUE
         AND u.transport = 'rest'
     )
     SELECT id_dgauser, ts, obra, codigo_obra, caudal_instantaneo,
            flujo_acumulado, nivel_freatico, attempts,
            rut_informante, clave_informante, max_retry_attempts
       FROM ranked
      WHERE rn = 1
      ORDER BY ts ASC
      LIMIT $1`,
    [limit],
    { name: 'dga__list_pending_for_submission' },
  );
  return r.rows;
}

/**
 * Lock pesimista: transición pendiente → enviando. Evita doble envío si
 * dos workers procesan el mismo slot simultáneamente (poco probable con
 * 1 worker, pero defensivo). El UPDATE filtra por estatus='pendiente'
 * de modo que solo uno gana.
 */
export async function lockSlotForSending(idDgaUser: number, ts: string): Promise<boolean> {
  const r = await query(
    `UPDATE dato_dga
        SET estatus            = 'enviando',
            ultimo_intento_at  = now()
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'pendiente'`,
    [idDgaUser, ts],
    { name: 'dga__lock_for_sending' },
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Transición enviando → enviado tras respuesta exitosa de SNIA.
 * Incrementa intentos para coincidir con attempt_n del audit.
 */
export async function markSlotEnviado(input: {
  id_dgauser: number;
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
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'enviando'`,
    [input.id_dgauser, input.ts, input.comprobante],
    { name: 'dga__mark_enviado' },
  );
}

/**
 * Transición enviando → rechazado tras respuesta fallida.
 *
 * Política Res 2170 §6.2: reenviar al día siguiente. Se setea
 * next_retry_at = now() + 24h y se vuelve a estatus 'pendiente' para
 * que el próximo ciclo lo reintente.
 *
 * Si intentos >= max_retry_attempts, se marca 'fallido' (terminal).
 * Requiere intervención manual para reintentar.
 */
export async function markSlotRechazado(input: {
  id_dgauser: number;
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
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'enviando'
      RETURNING intentos, estatus`,
    [input.id_dgauser, input.ts, input.fail_reason, input.max_retry_attempts],
    { name: 'dga__mark_rechazado' },
  );
  const row = r.rows[0];
  return {
    terminal: row?.estatus === 'fallido',
    attempts: row?.intentos ?? 0,
  };
}

/**
 * Inserta una fila en dga_send_audit. Append-only — nunca update ni delete.
 * Se llama después de CADA intento (éxito o falla), incluso si el HTTP no
 * devolvió 2xx, para tener trazabilidad completa.
 *
 * El password del payload viene ofuscado por el caller (snia-client.ts).
 */
export async function insertSendAudit(input: {
  id_dgauser: number;
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
       id_dgauser, ts, attempt_n, transport, http_status,
       dga_status_code, dga_message, api_n_comprobante, api_status_description,
       request_payload, raw_response, sent_at, duration_ms
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
              COALESCE($13::timestamptz, now()), $12)`,
    [
      input.id_dgauser,
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
// Importador legacy (CSV histórico)
// ============================================================================

/**
 * Resuelve los informantes DGA asociados a un código de obra (OB-XXXX-XXX).
 * Atraviesa pozo_config.obra_dga → sitio → dga_user. Devuelve array porque
 * un sitio puede tener múltiples informantes (UNIQUE site_id+rut_informante).
 *
 * Si devuelve 0 filas: ningún sitio tiene obra_dga=codigoObra cargado, o no
 * hay dga_user registrado. El importador debe abortar con error claro.
 */
export interface UserByCodigoObraRow {
  id_dgauser: string;
  site_id: string;
  rut_informante: string;
}
export async function findDgaUsersByCodigoObra(codigoObra: string): Promise<UserByCodigoObraRow[]> {
  const r = await query<UserByCodigoObraRow>(
    `SELECT u.id_dgauser, u.site_id, u.rut_informante
       FROM dga_user u
       JOIN pozo_config pc ON pc.sitio_id = u.site_id
      WHERE pc.obra_dga = $1
      ORDER BY u.created_at ASC`,
    [codigoObra],
    { name: 'dga__users_by_codigo_obra' },
  );
  return r.rows;
}

/**
 * Upsert de una medición histórica del CSV legacy en dato_dga.
 *
 * Comportamiento ON CONFLICT:
 *   - El slot puede no existir (CSV cubre meses antes del pre-seed).
 *   - El slot puede existir como 'vacio' (pre-seed creó el slot del mes
 *     actual pero todavía no se rellenó).
 *   - El slot puede existir ya como 'enviado' por una corrida previa del
 *     importador. En ese caso, sobrescribir es seguro (idempotente).
 *
 * Por simplicidad: ON CONFLICT (id_dgauser, ts) DO UPDATE — sobrescribe
 * cualquier slot anterior con los datos del CSV. Es la fuente de verdad
 * para datos históricos legacy.
 *
 * `flujo_acumulado` se guarda truncado entero (consistencia web/SNIA).
 * `totalizator_raw_legacy` preserva el decimal original del CSV.
 */
export async function upsertDatoDgaFromLegacy(input: {
  id_dgauser: number;
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
       id_dgauser, obra, ts,
       caudal_instantaneo, flujo_acumulado, totalizator_raw_legacy, nivel_freatico,
       estatus, comprobante, intentos, validation_warnings, fail_reason, next_retry_at
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       'enviado', $8, 1, '[]'::jsonb, NULL, NULL
     )
     ON CONFLICT (id_dgauser, ts) DO UPDATE SET
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
      input.id_dgauser,
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
// Review queue (slots requires_review)
// ============================================================================

/**
 * Slot esperando decisión admin. Trae datos para que la UI pueda mostrar
 * contexto y sugerencias sin más round-trips.
 */
export interface ReviewSlotRow {
  id_dgauser: string;
  ts: string;
  site_id: string;
  obra: string;
  codigo_obra: string | null;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
  validation_warnings: ValidationWarning[];
  fail_reason: string | null;
  nombre_informante: string;
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
    where += ` AND u.site_id = $${args.length}`;
  }
  const r = await query<ReviewSlotRow>(
    `SELECT
        d.id_dgauser,
        d.ts,
        u.site_id,
        d.obra,
        pc.obra_dga                 AS codigo_obra,
        d.caudal_instantaneo,
        d.flujo_acumulado,
        d.nivel_freatico,
        d.validation_warnings,
        d.fail_reason,
        u.nombre_informante
      FROM dato_dga d
      JOIN dga_user u USING (id_dgauser)
      LEFT JOIN pozo_config pc ON pc.sitio_id = u.site_id
     WHERE ${where}
     ORDER BY d.ts DESC
     LIMIT $1`,
    args,
    { name: 'dga__list_review_queue' },
  );
  return r.rows;
}

/**
 * Acepta el fallback sugerido (típicamente último totalizador válido) y
 * promueve el slot a 'pendiente' para que el submission worker lo envíe.
 * NO modifica los valores que no estén en el patch.
 */
export async function acceptReviewSlotWithValues(input: {
  id_dgauser: number;
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
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'requires_review'`,
    [
      input.id_dgauser,
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

/**
 * Descarta el slot definitivamente (estatus='fallido', terminal). Usar
 * cuando admin determina que la medición es irrecuperable (sensor roto,
 * dato corrupto, etc.) y prefiere no enviar a SNIA.
 */
export async function markReviewSlotFailedManual(input: {
  id_dgauser: number;
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
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'requires_review'`,
    [input.id_dgauser, input.ts, input.admin_note],
    { name: 'dga__mark_review_failed' },
  );
  return (r.rowCount ?? 0) > 0;
}

// ============================================================================
// Reconciler queries
// ============================================================================

/**
 * Slots que quedaron en 'enviando' por más de N minutos. Indica que el
 * proceso murió entre lockSlotForSending y mark{Enviado,Rechazado}. El
 * reconciler los revierte a 'pendiente' para que el próximo ciclo de
 * submission los reintente o, si el audit ya quedó registrado, los
 * arregle por la regla de drift OK/rechazo.
 *
 * Threshold típico: 15 min (suficiente para timeout HTTP 15s + margen).
 */
export interface StuckEnviandoRow {
  id_dgauser: string;
  ts: string;
}
export async function listStuckEnviando(thresholdMinutes: number): Promise<StuckEnviandoRow[]> {
  const r = await query<StuckEnviandoRow>(
    `SELECT id_dgauser, ts
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

/**
 * Revierte un slot atascado en 'enviando' a 'pendiente'. NO incrementa
 * intentos (no sabemos si SNIA llegó a recibir; el reconciler de drift
 * audit-vs-estado lo arreglará si hubo respuesta).
 */
export async function unlockStuckEnviando(idDgaUser: number, ts: string): Promise<void> {
  await query(
    `UPDATE dato_dga
        SET estatus = 'pendiente'
      WHERE id_dgauser = $1
        AND ts         = $2
        AND estatus    = 'enviando'`,
    [idDgaUser, ts],
    { name: 'dga__unlock_stuck' },
  );
}

/**
 * Drift positivo: audit dice 'enviado OK' (status='00' + comprobante) pero
 * el slot está en cualquier estado distinto de 'enviado'. Causas típicas:
 *   - Proceso murió entre INSERT audit y markSlotEnviado.
 *   - Bug en submission worker.
 * Acción: setear estatus='enviado' + copiar comprobante desde audit.
 */
export interface DriftEnviadoRow {
  id_dgauser: string;
  ts: string;
  api_n_comprobante: string;
  current_estatus: string;
}
export async function listDriftAuditEnviadoVsEstado(): Promise<DriftEnviadoRow[]> {
  const r = await query<DriftEnviadoRow>(
    `SELECT DISTINCT ON (a.id_dgauser, a.ts)
            a.id_dgauser,
            a.ts,
            a.api_n_comprobante,
            d.estatus AS current_estatus
       FROM dga_send_audit a
       JOIN dato_dga d USING (id_dgauser, ts)
      WHERE a.dga_status_code  = '00'
        AND a.api_n_comprobante IS NOT NULL
        AND d.estatus          <> 'enviado'
      ORDER BY a.id_dgauser, a.ts, a.sent_at DESC
      LIMIT 500`,
    [],
    { name: 'dga__drift_audit_enviado' },
  );
  return r.rows;
}

/**
 * Fix forzado: marca slot como 'enviado' con comprobante desde audit. A
 * diferencia de markSlotEnviado (submission), no exige estatus='enviando'
 * porque el slot puede estar en otros estados por el drift.
 *
 * No incrementa intentos: el audit ya tiene attempt_n correcto.
 */
export async function reconcileMarkEnviado(input: {
  id_dgauser: number;
  ts: string;
  comprobante: string;
}): Promise<void> {
  await query(
    `UPDATE dato_dga
        SET estatus       = 'enviado',
            comprobante   = $3,
            next_retry_at = NULL,
            fail_reason   = NULL
      WHERE id_dgauser = $1
        AND ts         = $2`,
    [input.id_dgauser, input.ts, input.comprobante],
    { name: 'dga__reconcile_mark_enviado' },
  );
}

/**
 * Slots en 'enviado' que no tienen ninguna fila audit. Anomalía grave:
 * el slot quedó como enviado sin trazabilidad. Solo alertar — NO mover
 * automáticamente porque podría ser un import legacy mal hecho o un fix
 * manual del admin.
 */
export interface EnviadoSinAuditRow {
  id_dgauser: string;
  ts: string;
  comprobante: string | null;
}
export async function listEnviadoSinAudit(): Promise<EnviadoSinAuditRow[]> {
  const r = await query<EnviadoSinAuditRow>(
    `SELECT d.id_dgauser, d.ts, d.comprobante
       FROM dato_dga d
      WHERE d.estatus = 'enviado'
        AND NOT EXISTS (
              SELECT 1 FROM dga_send_audit a
               WHERE a.id_dgauser = d.id_dgauser
                 AND a.ts         = d.ts
            )
      ORDER BY d.ts DESC
      LIMIT 100`,
    [],
    { name: 'dga__enviado_sin_audit' },
  );
  return r.rows;
}

/**
 * Slots con 2 o más audits OK ('00'). Posible doble envío a SNIA (riesgo
 * §6.3 — bloqueo del Centro de Control). Solo alertar — no se puede
 * "deshacer" un envío. Admin debe verificar en SNIA manualmente.
 */
export interface DoubleSendRow {
  id_dgauser: string;
  ts: string;
  ok_count: number;
}
export async function listDoubleSubmission(): Promise<DoubleSendRow[]> {
  const r = await query<DoubleSendRow>(
    `SELECT id_dgauser, ts, COUNT(*)::int AS ok_count
       FROM dga_send_audit
      WHERE dga_status_code = '00'
      GROUP BY id_dgauser, ts
     HAVING COUNT(*) > 1
      ORDER BY id_dgauser, ts
      LIMIT 100`,
    [],
    { name: 'dga__double_submission' },
  );
  return r.rows;
}

export async function queryDatoDga(
  idDgaUser: number,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const r = await query<DatoDgaRow>(
    `SELECT id_dgauser, obra, ts,
            to_char(fecha, 'YYYY-MM-DD')       AS fecha,
            to_char(hora,  'HH24:MI:SS')       AS hora,
            caudal_instantaneo, flujo_acumulado, nivel_freatico,
            estatus, comprobante
       FROM dato_dga
      WHERE id_dgauser = $1
        AND ts >= $2 AND ts < $3
      ORDER BY ts ASC`,
    [idDgaUser, desde, hasta],
    { name: 'dga__query_dato' },
  );
  return r.rows;
}

export async function queryDatoDgaBySite(
  siteId: string,
  desde: string,
  hasta: string,
): Promise<DatoDgaRow[]> {
  const r = await query<DatoDgaRow>(
    `SELECT d.id_dgauser, d.obra, d.ts,
            to_char(d.fecha, 'YYYY-MM-DD')      AS fecha,
            to_char(d.hora,  'HH24:MI:SS')      AS hora,
            d.caudal_instantaneo, d.flujo_acumulado, d.nivel_freatico,
            d.estatus, d.comprobante
       FROM dato_dga d
       JOIN dga_user u USING (id_dgauser)
      WHERE u.site_id = $1
        AND d.ts >= $2 AND d.ts < $3
      ORDER BY d.ts ASC`,
    [siteId, desde, hasta],
    { name: 'dga__query_dato_by_site' },
  );
  return r.rows;
}
