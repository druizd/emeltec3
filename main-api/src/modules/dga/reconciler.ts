/**
 * Worker reconciler DGA.
 *
 * Red de seguridad que corre cada 1h y corrige drift entre `dga_send_audit`
 * (append-only, fuente de verdad de qué se envió) y `dato_dga.estatus`
 * (estado actual del slot). Cubre fallos del submission worker como crashes
 * entre el INSERT audit y el UPDATE estatus.
 *
 * Casos cubiertos:
 *   (A) Slot atascado en 'enviando' >15 min → revertir a 'pendiente'.
 *       Causa: proceso murió entre lockSlotForSending y mark*. El audit ya
 *       puede o no estar; si está, el caso (B) lo arregla en este mismo ciclo.
 *
 *   (B) Audit con status='00' + comprobante, pero slot ≠ 'enviado' →
 *       setear 'enviado' + copiar comprobante. SNIA recibió la medición;
 *       solo nos faltó persistir el cambio de estado.
 *
 *   (C) Slot 'enviado' SIN ninguna fila audit → anomalía grave, solo alerta.
 *       Posibles causas: import legacy mal hecho, fix manual del admin sin
 *       audit. NO se mueve automáticamente (no sabemos qué es).
 *
 *   (D) ≥2 audits OK ('00') para el mismo slot → posible doble envío a SNIA.
 *       Riesgo §6.3 (bloqueo del Centro de Control). Solo alertar — no se
 *       puede deshacer; admin debe verificar en SNIA manualmente.
 *
 * No cubierto en este worker (por ahora):
 *   - GET SNIA por comprobante para verificar estado real. Útil pero opcional;
 *     SNIA puede revocar comprobantes en raros casos. Agregable luego.
 *   - Drift audit rechazo vs estado pendiente: no es drift real porque el
 *     próximo ciclo de submission lo intentará igual (idempotente por
 *     next_retry_at).
 *
 * Frecuencia: 1h por defecto. Más frecuente desperdicia ciclos; menos
 * frecuente deja drift visible al admin por demasiado tiempo.
 *
 * En cluster, encender SOLO en una réplica.
 */
import { logger } from '../../config/logger';
import {
  listDoubleSubmission,
  listDriftAuditEnviadoVsEstado,
  listEnviadoSinAudit,
  listStuckEnviando,
  reconcileMarkEnviado,
  unlockStuckEnviando,
} from './repo';
import { sendDgaAdminAlert } from './notifier';

const POLL_INTERVAL_MS = Number(process.env.DGA_RECONCILER_POLL_MS ?? 60 * 60 * 1000);
const STUCK_THRESHOLD_MINUTES = Number(process.env.DGA_RECONCILER_STUCK_MIN ?? 15);
const WORKER_ENABLED =
  String(process.env.ENABLE_DGA_RECONCILER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Caso (A): slots atascados en 'enviando'. Los revierte a 'pendiente'.
 * Si el audit OK ya está registrado, el caso (B) en el mismo ciclo los
 * promueve a 'enviado'.
 */
async function reconcileStuckEnviando(): Promise<number> {
  const stuck = await listStuckEnviando(STUCK_THRESHOLD_MINUTES);
  for (const slot of stuck) {
    try {
      await unlockStuckEnviando(Number(slot.id_dgauser), slot.ts);
      logger.warn(
        { id_dgauser: slot.id_dgauser, ts: slot.ts },
        'reconciler (A): slot atascado en enviando → revertido a pendiente',
      );
    } catch (err) {
      logger.error(
        { id_dgauser: slot.id_dgauser, ts: slot.ts, err: (err as Error).message },
        'reconciler (A): fallo al revertir slot atascado',
      );
    }
  }
  return stuck.length;
}

/**
 * Caso (B): audit dice OK pero el slot no está en 'enviado'. Aplicar fix.
 */
async function reconcileDriftEnviado(): Promise<number> {
  const drift = await listDriftAuditEnviadoVsEstado();
  for (const slot of drift) {
    try {
      await reconcileMarkEnviado({
        id_dgauser: Number(slot.id_dgauser),
        ts: slot.ts,
        comprobante: slot.api_n_comprobante,
      });
      logger.warn(
        {
          id_dgauser: slot.id_dgauser,
          ts: slot.ts,
          previous: slot.current_estatus,
          comprobante: slot.api_n_comprobante,
        },
        'reconciler (B): drift audit OK vs estado → fix a enviado',
      );
    } catch (err) {
      logger.error(
        { id_dgauser: slot.id_dgauser, ts: slot.ts, err: (err as Error).message },
        'reconciler (B): fallo al fixear drift',
      );
    }
  }
  return drift.length;
}

/**
 * Caso (C): slots 'enviado' sin audit. Solo alerta; no se mueve nada.
 * Notifica al admin por email si hay 1+ hallazgos.
 */
async function reportEnviadoSinAudit(): Promise<number> {
  const orphans = await listEnviadoSinAudit();
  for (const slot of orphans) {
    logger.error(
      { id_dgauser: slot.id_dgauser, ts: slot.ts, comprobante: slot.comprobante },
      'reconciler (C): slot enviado SIN audit — anomalía, revisar manualmente',
    );
  }
  if (orphans.length > 0) {
    const lines = orphans
      .slice(0, 50)
      .map((o) => `- id_dgauser=${o.id_dgauser} ts=${o.ts} comprobante=${o.comprobante ?? '(null)'}`);
    await sendDgaAdminAlert({
      subject: `[DGA] ${orphans.length} slot(s) enviado(s) SIN audit`,
      body:
        `El reconciler detectó ${orphans.length} slot(s) en estado 'enviado' sin ` +
        `ningún registro en dga_send_audit.\n\n` +
        `Causas posibles: import legacy mal hecho, fix manual del admin, bug en submission.\n` +
        `Acción: revisar manualmente cada caso. NO se auto-corrige.\n\n` +
        `Primeros ${Math.min(orphans.length, 50)} casos:\n` +
        lines.join('\n'),
    });
  }
  return orphans.length;
}

/**
 * Caso (D): doble envío detectado. Solo alerta; no se puede deshacer.
 * Notifica al admin por email — caso de riesgo §6.3 (bloqueo del Centro
 * de Control si SNIA detecta el patrón).
 */
async function reportDoubleSubmission(): Promise<number> {
  const doubles = await listDoubleSubmission();
  for (const slot of doubles) {
    logger.error(
      { id_dgauser: slot.id_dgauser, ts: slot.ts, ok_count: slot.ok_count },
      'reconciler (D): posible doble envío a SNIA — verificar en MIA-DGA',
    );
  }
  if (doubles.length > 0) {
    const lines = doubles
      .slice(0, 50)
      .map((d) => `- id_dgauser=${d.id_dgauser} ts=${d.ts} envíos_OK=${d.ok_count}`);
    await sendDgaAdminAlert({
      subject: `[DGA] ${doubles.length} slot(s) con doble envío a SNIA`,
      body:
        `El reconciler detectó ${doubles.length} slot(s) con 2 o más audits OK ` +
        `(status='00') a SNIA. Esto puede activar bloqueo del Centro de Control ` +
        `según Res 2170 §6.3.\n\n` +
        `Acción: verificar en MIA-DGA y, si es legítimo, ignorar. Si es bug, ` +
        `revisar el lock del submission worker.\n\n` +
        `Primeros ${Math.min(doubles.length, 50)} casos:\n` +
        lines.join('\n'),
    });
  }
  return doubles.length;
}

export async function runReconcilerCycle(): Promise<void> {
  try {
    const stuck = await reconcileStuckEnviando();
    const driftEnviado = await reconcileDriftEnviado();
    const sinAudit = await reportEnviadoSinAudit();
    const doubles = await reportDoubleSubmission();

    if (stuck > 0 || driftEnviado > 0 || sinAudit > 0 || doubles > 0) {
      logger.info(
        {
          stuck_unlocked: stuck,
          drift_enviado_fixed: driftEnviado,
          enviado_sin_audit: sinAudit,
          double_submission: doubles,
        },
        'DGA reconciler: ciclo con hallazgos',
      );
    } else {
      logger.debug('DGA reconciler: ciclo OK sin hallazgos');
    }
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'DGA reconciler: ciclo falló');
  }
}

export function startDgaReconcilerWorker(): void {
  if (intervalHandle) return;
  if (!WORKER_ENABLED) {
    logger.info('DGA reconciler deshabilitado (ENABLE_DGA_RECONCILER=false)');
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'DGA reconciler iniciado');
  // Bootstrap inmediato: tras un reinicio del proceso, queremos recuperar
  // cualquier drift acumulado sin esperar al primer tick (1h por default).
  void runReconcilerCycle();
  intervalHandle = setInterval(() => {
    void runReconcilerCycle();
  }, POLL_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopDgaReconcilerWorker(): void {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('DGA reconciler detenido');
}
