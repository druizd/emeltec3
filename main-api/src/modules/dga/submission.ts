/**
 * Worker submission DGA (modelo redesign 2026-05-17).
 *
 * Lee slots pendiente listos para envío + POST a SNIA + audit append-only.
 * Filtra por pozo_config.dga_transport='rest' (única forma de enviar real).
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

async function processSlot(
  slot: PendingSubmissionRow,
): Promise<'enviado' | 'rechazado' | 'fallido' | 'skipped'> {
  if (!slot.codigo_obra) {
    logger.warn(
      { site_id: slot.site_id, ts: slot.ts },
      'submission: pozo sin codigo_obra (obra_dga) — slot no enviado',
    );
    await markSlotRechazado({
      site_id: slot.site_id,
      ts: slot.ts,
      fail_reason: 'pozo_sin_codigo_obra',
      max_retry_attempts: slot.max_retry_attempts,
    });
    return 'skipped';
  }

  if (!slot.rut_informante || !slot.clave_informante) {
    logger.warn(
      { site_id: slot.site_id, ts: slot.ts },
      'submission: pozo sin informante asociado — slot no enviado',
    );
    await markSlotRechazado({
      site_id: slot.site_id,
      ts: slot.ts,
      fail_reason: 'pozo_sin_informante',
      max_retry_attempts: slot.max_retry_attempts,
    });
    return 'skipped';
  }

  const locked = await lockSlotForSending(slot.site_id, slot.ts);
  if (!locked) {
    logger.debug(
      { site_id: slot.site_id, ts: slot.ts },
      'submission: slot cambió de estado antes del lock',
    );
    return 'skipped';
  }

  const { fechaMedicion, horaMedicion } = tsToChileLocal(slot.ts);
  const attemptN = slot.attempts + 1;

  let password: string;
  try {
    password = decryptClave(slot.clave_informante);
  } catch (err) {
    logger.error(
      { site_id: slot.site_id, err: (err as Error).message },
      'submission: clave no se pudo descifrar',
    );
    await markSlotRechazado({
      site_id: slot.site_id,
      ts: slot.ts,
      fail_reason: 'clave_decrypt_error',
      max_retry_attempts: slot.max_retry_attempts,
    });
    await insertSendAudit({
      site_id: slot.site_id,
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
    const msg = (err as Error).message;
    logger.error(
      { site_id: slot.site_id, ts: slot.ts, err: msg },
      'submission: error pre-envío',
    );
    await markSlotRechazado({
      site_id: slot.site_id,
      ts: slot.ts,
      fail_reason: `pre_send_error: ${msg}`,
      max_retry_attempts: slot.max_retry_attempts,
    });
    await insertSendAudit({
      site_id: slot.site_id,
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

  // Audit antes de mover estado: reconciler arregla drift si proceso muere
  // entre audit y mark.
  await insertSendAudit({
    site_id: slot.site_id,
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
      site_id: slot.site_id,
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
    site_id: slot.site_id,
    ts: slot.ts,
    fail_reason: failReason,
    max_retry_attempts: slot.max_retry_attempts,
  });
  return terminal ? 'fallido' : 'rechazado';
}

export async function runSubmissionCycle(): Promise<void> {
  if (!config.dga.submissionEnabled) return;
  if (!config.dga.rutEmpresa) {
    logger.warn('DGA submission: DGA_RUT_EMPRESA no configurado, ciclo omitido');
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
        { site_id: slot.site_id, ts: slot.ts, err: (err as Error).message },
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
