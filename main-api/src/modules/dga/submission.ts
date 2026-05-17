/**
 * Worker submission DGA.
 *
 * Lee slots en estatus='pendiente' listos para envío (filtro por
 * dga_user.transport='rest', activo=true, next_retry_at vencido), los envía
 * a SNIA vía REST y registra audit por cada intento (éxito o falla).
 *
 * Política Res 2170 §6:
 *   §6.1 — Separación ≥5min entre acumulados del mismo informante. Se cumple
 *          tomando 1 slot por informante por ciclo (cycle=5min default).
 *   §6.2 — Tras rechazo, reenviar al día siguiente. Implementado via
 *          next_retry_at = now() + 24h en markSlotRechazado.
 *   §6.3 — No retransmitir mediciones ya recibidas. Se cumple porque
 *          UPDATE filtra por estatus='enviando' (lock pesimista).
 *   §7  — Bloqueos por tráfico anómalo. Se mitiga con cap de 50 envíos/ciclo
 *          y 1 por informante.
 *
 * Kill switch:
 *   - ENABLE_DGA_SUBMISSION_WORKER (env) controla arranque del worker.
 *     Default OFF — no se envía nada hasta autorización de gerencia.
 *   - dga_user.transport='off'|'shadow' excluye al informante del envío.
 *     Solo 'rest' es considerado.
 *
 * En cluster, encender SOLO en una réplica.
 */
import { logger } from '../../config/logger';
import { config } from '../../config/appConfig';
import { decryptClave } from './crypto';
import {
  insertSendAudit,
  listPendingForSubmission,
  lockSlotForSending,
  markSlotEnviado,
  markSlotRechazado,
  type PendingSubmissionRow,
} from './repo';
import { sendToSnia, type SniaSendResult } from './snia-client';

const POLL_INTERVAL_MS = Number(process.env.DGA_SUBMISSION_POLL_MS ?? 5 * 60 * 1000);
const MAX_PER_CYCLE = Number(process.env.DGA_SUBMISSION_MAX_PER_CYCLE ?? 50);

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Convierte un TIMESTAMPTZ UTC al par (fechaMedicion, horaMedicion) en
 * hora local Chile (UTC-4 fijo, sin DST). Formato requerido por SNIA
 * según Res 2170 §4.
 */
function tsToChileLocal(tsIso: string): { fechaMedicion: string; horaMedicion: string } {
  const t = new Date(tsIso).getTime() - 4 * 60 * 60 * 1000;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return {
    fechaMedicion: `${yyyy}-${MM}-${dd}`,
    horaMedicion: `${HH}:${mm}:${ss}`,
  };
}

function numericOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function processSlot(slot: PendingSubmissionRow): Promise<'enviado' | 'rechazado' | 'fallido' | 'skipped'> {
  const idDgaUser = Number(slot.id_dgauser);

  // Guard: codigo_obra obligatorio para SNIA. Si no está cargado, no podemos
  // enviar. Se trata como rechazo aplicativo (no es un error de SNIA).
  if (!slot.codigo_obra) {
    logger.warn(
      { id_dgauser: idDgaUser, ts: slot.ts },
      'submission: pozo sin codigo_obra (obra_dga) cargado — slot no enviado',
    );
    const result = await markSlotRechazado({
      id_dgauser: idDgaUser,
      ts: slot.ts,
      fail_reason: 'pozo_sin_codigo_obra',
      max_retry_attempts: slot.max_retry_attempts,
    });
    void result;
    return 'skipped';
  }

  // Lock: solo uno gana si el slot está siendo procesado.
  const locked = await lockSlotForSending(idDgaUser, slot.ts);
  if (!locked) {
    logger.debug(
      { id_dgauser: idDgaUser, ts: slot.ts },
      'submission: slot ya tomado por otro proceso (race) o cambió de estado',
    );
    return 'skipped';
  }

  const { fechaMedicion, horaMedicion } = tsToChileLocal(slot.ts);
  const attemptN = slot.attempts + 1;

  // Descifra clave en memoria. Nunca persistir el plaintext.
  let password: string;
  try {
    password = decryptClave(slot.clave_informante);
  } catch (err) {
    logger.error(
      { id_dgauser: idDgaUser, err: (err as Error).message },
      'submission: clave_informante no se pudo descifrar — slot a rechazado',
    );
    await markSlotRechazado({
      id_dgauser: idDgaUser,
      ts: slot.ts,
      fail_reason: 'clave_decrypt_error',
      max_retry_attempts: slot.max_retry_attempts,
    });
    await insertSendAudit({
      id_dgauser: idDgaUser,
      ts: slot.ts,
      attempt_n: attemptN,
      transport: 'rest',
      http_status: null,
      dga_status_code: null,
      dga_message: 'clave_decrypt_error',
      api_n_comprobante: null,
      api_status_description: null,
      request_payload: null,
      raw_response: null,
      duration_ms: 0,
    });
    return 'rechazado';
  }

  let result: SniaSendResult;
  try {
    result = await sendToSnia({
      codigoObra: slot.codigo_obra,
      rutInformante: slot.rut_informante,
      password,
      fechaMedicion,
      horaMedicion,
      caudal: numericOrNull(slot.caudal_instantaneo),
      totalizador: numericOrNull(slot.flujo_acumulado),
      nivelFreatico: numericOrNull(slot.nivel_freatico),
    });
  } catch (err) {
    // Error de configuración (rutEmpresa missing, payload inválido).
    // Marca rechazo y registra audit para diagnóstico.
    const msg = (err as Error).message;
    logger.error(
      { id_dgauser: idDgaUser, ts: slot.ts, err: msg },
      'submission: error pre-envío',
    );
    await markSlotRechazado({
      id_dgauser: idDgaUser,
      ts: slot.ts,
      fail_reason: `pre_send_error: ${msg}`,
      max_retry_attempts: slot.max_retry_attempts,
    });
    await insertSendAudit({
      id_dgauser: idDgaUser,
      ts: slot.ts,
      attempt_n: attemptN,
      transport: 'rest',
      http_status: null,
      dga_status_code: null,
      dga_message: msg,
      api_n_comprobante: null,
      api_status_description: null,
      request_payload: null,
      raw_response: null,
      duration_ms: 0,
    });
    return 'rechazado';
  }

  // Audit append-only ANTES de mover estado: si el proceso muere entre
  // audit y mark, el reconciler verá el comprobante en audit y arreglará
  // el estatus. Si fuera al revés (mark sin audit) perderíamos la traza.
  await insertSendAudit({
    id_dgauser: idDgaUser,
    ts: slot.ts,
    attempt_n: attemptN,
    transport: 'rest',
    http_status: result.http_status,
    dga_status_code: result.dga_status_code,
    dga_message: result.dga_message,
    api_n_comprobante: result.numero_comprobante,
    api_status_description: null,
    request_payload: result.request_payload_redacted,
    raw_response: result.raw_response,
    duration_ms: result.duration_ms,
  });

  if (result.ok && result.numero_comprobante) {
    await markSlotEnviado({
      id_dgauser: idDgaUser,
      ts: slot.ts,
      comprobante: result.numero_comprobante,
    });
    return 'enviado';
  }

  const failReason =
    result.dga_status_code != null
      ? `dga_status_${result.dga_status_code}`
      : (result.dga_message ?? 'unknown_failure');
  const { terminal } = await markSlotRechazado({
    id_dgauser: idDgaUser,
    ts: slot.ts,
    fail_reason: failReason,
    max_retry_attempts: slot.max_retry_attempts,
  });
  return terminal ? 'fallido' : 'rechazado';
}

export async function runSubmissionCycle(): Promise<void> {
  if (!config.dga.submissionEnabled) {
    return;
  }
  if (!config.dga.rutEmpresa) {
    logger.warn(
      'DGA submission: DGA_RUT_EMPRESA no configurado, ciclo omitido',
    );
    return;
  }

  let pending: PendingSubmissionRow[];
  try {
    pending = await listPendingForSubmission(MAX_PER_CYCLE);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'DGA submission: lectura cola falló');
    return;
  }

  if (pending.length === 0) return;

  let enviado = 0;
  let rechazado = 0;
  let fallido = 0;
  let skipped = 0;

  for (const slot of pending) {
    try {
      const outcome = await processSlot(slot);
      if (outcome === 'enviado') enviado++;
      else if (outcome === 'rechazado') rechazado++;
      else if (outcome === 'fallido') fallido++;
      else skipped++;
    } catch (err) {
      logger.error(
        { id_dgauser: slot.id_dgauser, ts: slot.ts, err: (err as Error).message },
        'DGA submission: fallo procesando slot',
      );
    }
  }

  logger.info(
    { ciclo: pending.length, enviado, rechazado, fallido, skipped },
    'DGA submission: ciclo completo',
  );
}

export function startDgaSubmissionWorker(): void {
  if (intervalHandle) return;
  if (!config.dga.submissionEnabled) {
    logger.info('DGA submission worker deshabilitado (ENABLE_DGA_SUBMISSION_WORKER=false)');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'DGA submission worker iniciado');
  // Sin bootstrap inmediato: damos margen al fill worker para llenar cola
  // tras un reinicio. El primer tick corre tras POLL_INTERVAL_MS.
  intervalHandle = setInterval(() => {
    void runSubmissionCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopDgaSubmissionWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('DGA submission worker detenido');
}
