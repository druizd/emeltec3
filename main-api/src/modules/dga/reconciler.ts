/**
 * Worker reconciler DGA (modelo redesign 2026-05-17).
 *
 * Red de seguridad cada 1h. Compara dga_send_audit vs dato_dga.estatus y
 * corrige drift; alerta admin en anomalías terminales (sin audit, doble OK).
 */
import { logger } from '../../config/logger';
import { beat } from '../../config/heartbeat';
import {
  listDoubleSubmission,
  listDriftAuditEnviadoVsEstado,
  listEnviadoSinAudit,
  listStuckEnviando,
  listVacioSlotsStale,
  reconcileMarkEnviado,
  unlockStuckEnviando,
} from './repo';
import { sendDgaAdminAlert } from './notifier';

const POLL_INTERVAL_MS = Number(process.env.DGA_RECONCILER_POLL_MS ?? 60 * 60 * 1000);
const STUCK_THRESHOLD_MINUTES = Number(process.env.DGA_RECONCILER_STUCK_MIN ?? 15);
const STALE_VACIO_HOURS = Number(process.env.DGA_RECONCILER_STALE_VACIO_HOURS ?? 6);
const WORKER_ENABLED =
  String(process.env.ENABLE_DGA_RECONCILER ?? 'true').toLowerCase() !== 'false';

let intervalHandle: NodeJS.Timeout | null = null;

async function reconcileStuckEnviando(): Promise<number> {
  const stuck = await listStuckEnviando(STUCK_THRESHOLD_MINUTES);
  for (const slot of stuck) {
    try {
      await unlockStuckEnviando(slot.site_id, slot.ts);
      logger.warn(
        { site_id: slot.site_id, ts: slot.ts },
        'reconciler (A): slot atascado en enviando → revertido a pendiente',
      );
    } catch (err) {
      logger.error(
        { site_id: slot.site_id, ts: slot.ts, err: (err as Error).message },
        'reconciler (A): fallo al revertir slot atascado',
      );
    }
  }
  return stuck.length;
}

async function reconcileDriftEnviado(): Promise<number> {
  const drift = await listDriftAuditEnviadoVsEstado();
  for (const slot of drift) {
    try {
      await reconcileMarkEnviado({
        site_id: slot.site_id,
        ts: slot.ts,
        comprobante: slot.api_n_comprobante,
      });
      logger.warn(
        {
          site_id: slot.site_id,
          ts: slot.ts,
          previous: slot.current_estatus,
          comprobante: slot.api_n_comprobante,
        },
        'reconciler (B): drift audit OK vs estado → fix a enviado',
      );
    } catch (err) {
      logger.error(
        { site_id: slot.site_id, ts: slot.ts, err: (err as Error).message },
        'reconciler (B): fallo al fixear drift',
      );
    }
  }
  return drift.length;
}

async function reportEnviadoSinAudit(): Promise<number> {
  const orphans = await listEnviadoSinAudit();
  for (const slot of orphans) {
    logger.error(
      { site_id: slot.site_id, ts: slot.ts, comprobante: slot.comprobante },
      'reconciler (C): slot enviado SIN audit — anomalía, revisar manualmente',
    );
  }
  if (orphans.length > 0) {
    const lines = orphans
      .slice(0, 50)
      .map((o) => `- site=${o.site_id} ts=${o.ts} comprobante=${o.comprobante ?? '(null)'}`);
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

async function reportDoubleSubmission(): Promise<number> {
  const doubles = await listDoubleSubmission();
  for (const slot of doubles) {
    logger.error(
      { site_id: slot.site_id, ts: slot.ts, ok_count: slot.ok_count },
      'reconciler (D): posible doble envío a SNIA — verificar en MIA-DGA',
    );
  }
  if (doubles.length > 0) {
    const lines = doubles
      .slice(0, 50)
      .map((d) => `- site=${d.site_id} ts=${d.ts} envíos_OK=${d.ok_count}`);
    await sendDgaAdminAlert({
      subject: `[DGA] ${doubles.length} slot(s) con doble envío a SNIA`,
      body:
        `El reconciler detectó ${doubles.length} slot(s) con 2 o más audits OK ` +
        `(status='00') a SNIA. Puede activar bloqueo del Centro de Control ` +
        `(Res 2170 §6.3).\n\n` +
        `Acción: verificar en MIA-DGA. Si es bug, revisar lock del submission.\n\n` +
        `Primeros ${Math.min(doubles.length, 50)} casos:\n` +
        lines.join('\n'),
    });
  }
  return doubles.length;
}

// Throttle in-memory: evita reenviar el mismo digest cada hora si los slots
// stale no cambian. Si entra/sale un slot, firma cambia y se manda nuevo
// digest. Resetea al reiniciar el proceso (aceptable: max 1 alerta post-deploy).
let lastStaleSignature = '';

async function reportVacioStale(): Promise<number> {
  const stale = await listVacioSlotsStale(STALE_VACIO_HOURS);
  if (stale.length === 0) {
    lastStaleSignature = '';
    return 0;
  }

  const signature = stale.map((s) => `${s.site_id}:${s.ts}`).join('|');
  if (signature === lastStaleSignature) {
    logger.debug({ count: stale.length }, 'reconciler (E): stale set sin cambios, skip alerta');
    return stale.length;
  }
  lastStaleSignature = signature;

  const bySite = new Map<string, { ts: string; hours_stale: number }[]>();
  for (const s of stale) {
    const arr = bySite.get(s.site_id) ?? [];
    arr.push({ ts: s.ts, hours_stale: Number(s.hours_stale) });
    bySite.set(s.site_id, arr);
  }

  const sections: string[] = [];
  for (const [siteId, slots] of bySite.entries()) {
    sections.push(`\nSitio ${siteId} (${slots.length} slot(s)):`);
    sections.push(
      ...slots
        .slice(0, 10)
        .map((sl) => `  - ts=${sl.ts} (vacio hace ${sl.hours_stale.toFixed(1)}h)`),
    );
    if (slots.length > 10) sections.push(`  ... y ${slots.length - 10} más`);
  }

  logger.warn({ total: stale.length, sites: bySite.size }, 'reconciler (E): slots vacios stale');

  await sendDgaAdminAlert({
    subject: `[DGA] ${stale.length} slot(s) sin dato hace >${STALE_VACIO_HOURS}h`,
    body:
      `Detectados ${stale.length} slot(s) en estado 'vacio' con antigüedad mayor a ` +
      `${STALE_VACIO_HOURS} horas. El fill worker no logra encontrar el bucket exacto ` +
      `de medición correspondiente.\n\n` +
      `Causas posibles: equipo offline / sin señal, equipo no emite en boundary del slot, ` +
      `pozo_config.dga_hora_inicio mal alineada.\n\n` +
      `NO se reportará a DGA hasta que el dato real arribe.\n\n` +
      `Desglose por sitio:` +
      sections.join('\n'),
  });

  return stale.length;
}

export async function runReconcilerCycle(): Promise<void> {
  beat('dgaReconciler');
  try {
    const stuck = await reconcileStuckEnviando();
    const driftEnviado = await reconcileDriftEnviado();
    const sinAudit = await reportEnviadoSinAudit();
    const doubles = await reportDoubleSubmission();
    const stale = await reportVacioStale();

    if (stuck > 0 || driftEnviado > 0 || sinAudit > 0 || doubles > 0 || stale > 0) {
      logger.info(
        {
          stuck_unlocked: stuck,
          drift_enviado_fixed: driftEnviado,
          enviado_sin_audit: sinAudit,
          double_submission: doubles,
          vacio_stale: stale,
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
