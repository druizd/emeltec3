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
  listSitiosDesconectados,
  listStuckEnviando,
  listVacioSlotsStale,
  reconcileMarkEnviado,
  unlockStuckEnviando,
} from './repo';
import { sendDgaAdminAlert } from './notifier';

// Base del frontend para links clickeables en el mail (no navega si no hay
// sesión, pero deja el sitio a un click una vez logueado).
const FRONTEND_BASE = (process.env.FRONTEND_URL || 'https://nuevacloud.emeltec.cl/login').replace(
  /\/login\/?$/,
  '',
);
// tipo_sitio → segmento de ruta del detalle (ver frontend site-type-ui.ts).
const TIPO_RUTA: Record<string, string> = {
  pozo: 'water',
  vertiente: 'vertiente',
  canal: 'canal',
  electrico: 'electric',
  riles: 'riles',
};
function siteUrl(siteId: string, tipo: string): string {
  const seg = TIPO_RUTA[tipo] ?? 'water';
  return `${FRONTEND_BASE}/companies/${siteId}/${seg}`;
}

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

/**
 * Una sección de alerta del reconciler. `block`/`sig` en null cuando no hay
 * hallazgos. runReconcilerCycle junta todas las secciones en UN solo correo
 * (evita el spam de un email por categoría por ciclo).
 */
interface AlertPart {
  count: number;
  block: string | null;
  sig: string;
}

async function reportEnviadoSinAudit(): Promise<AlertPart> {
  const orphans = await listEnviadoSinAudit();
  for (const slot of orphans) {
    logger.error(
      { site_id: slot.site_id, ts: slot.ts, comprobante: slot.comprobante },
      'reconciler (C): slot enviado SIN audit — anomalía, revisar manualmente',
    );
  }
  if (orphans.length === 0) return { count: 0, block: null, sig: '' };
  const lines = orphans
    .slice(0, 50)
    .map((o) => `  - site=${o.site_id} ts=${o.ts} comprobante=${o.comprobante ?? '(null)'}`);
  const block =
    `▸ ${orphans.length} slot(s) en estado 'enviado' SIN registro en dga_send_audit.\n` +
    `  Causas: import legacy, fix manual del admin, bug en submission. ` +
    `Acción: revisar manualmente (NO se auto-corrige).\n` +
    `  Primeros ${Math.min(orphans.length, 50)}:\n` +
    lines.join('\n');
  return {
    count: orphans.length,
    block,
    sig: `C:${orphans.map((o) => o.site_id + o.ts).join(',')}`,
  };
}

async function reportDoubleSubmission(): Promise<AlertPart> {
  const doubles = await listDoubleSubmission();
  for (const slot of doubles) {
    logger.error(
      { site_id: slot.site_id, ts: slot.ts, ok_count: slot.ok_count },
      'reconciler (D): posible doble envío a SNIA — verificar en MIA-DGA',
    );
  }
  if (doubles.length === 0) return { count: 0, block: null, sig: '' };
  const lines = doubles
    .slice(0, 50)
    .map((d) => `  - site=${d.site_id} ts=${d.ts} envíos_OK=${d.ok_count}`);
  const block =
    `▸ ${doubles.length} slot(s) con 2+ audits OK (status='00') a SNIA — posible doble envío ` +
    `(puede activar bloqueo del Centro de Control, Res 2170 §6.3).\n` +
    `  Acción: verificar en MIA-DGA. Si es bug, revisar lock del submission.\n` +
    `  Primeros ${Math.min(doubles.length, 50)}:\n` +
    lines.join('\n');
  return {
    count: doubles.length,
    block,
    sig: `D:${doubles.map((d) => d.site_id + d.ts).join(',')}`,
  };
}

// Throttle in-memory del DIGEST completo: si el conjunto de hallazgos no cambia
// entre ciclos, no se reenvía el correo. Resetea al reiniciar el proceso.
let lastDigestSignature = '';

async function reportVacioStale(): Promise<AlertPart> {
  const stale = await listVacioSlotsStale(STALE_VACIO_HOURS);
  if (stale.length === 0) {
    return { count: 0, block: null, sig: '' };
  }

  const bySite = new Map<string, { ts: string; hours_stale: number }[]>();
  for (const s of stale) {
    const arr = bySite.get(s.site_id) ?? [];
    arr.push({ ts: s.ts, hours_stale: Number(s.hours_stale) });
    bySite.set(s.site_id, arr);
  }

  const sections: string[] = [];
  for (const [siteId, slots] of bySite.entries()) {
    sections.push(`  Sitio ${siteId} (${slots.length} slot(s)):  ${siteUrl(siteId, 'pozo')}`);
    sections.push(
      ...slots
        .slice(0, 10)
        .map((sl) => `    - ts=${sl.ts} (vacio hace ${sl.hours_stale.toFixed(1)}h)`),
    );
    if (slots.length > 10) sections.push(`    ... y ${slots.length - 10} más`);
  }

  logger.warn({ total: stale.length, sites: bySite.size }, 'reconciler (E): slots vacios stale');

  const block =
    `▸ ${stale.length} slot(s) en estado 'vacio' con antigüedad > ${STALE_VACIO_HOURS}h. ` +
    `El fill worker no encuentra el bucket exacto.\n` +
    `  Causas: equipo offline/sin señal, no emite en boundary del slot, ` +
    `pozo_config.dga_hora_inicio mal alineada. NO se reporta a DGA hasta que llegue el dato.\n` +
    sections.join('\n');
  return {
    count: stale.length,
    block,
    sig: `E:${stale.map((s) => `${s.site_id}:${s.ts}`).join('|')}`,
  };
}

const DESCONEXION_HORAS = Number(process.env.DGA_DESCONEXION_HORAS ?? STALE_VACIO_HOURS);

/** Sitios que dejaron de enviar datos hace > DESCONEXION_HORAS. */
async function reportSitiosDesconectados(): Promise<AlertPart> {
  const sitios = await listSitiosDesconectados(DESCONEXION_HORAS);
  if (sitios.length === 0) return { count: 0, block: null, sig: '' };
  logger.warn({ total: sitios.length }, 'reconciler (F): sitios desconectados');
  const lines = sitios.slice(0, 50).map((s) => {
    const scope = [s.empresa, s.sub_empresa].filter(Boolean).join(' / ') || '—';
    return (
      `  - ${s.descripcion} (${scope}) — ${Number(s.horas).toFixed(1)}h sin datos\n` +
      `    ${siteUrl(s.id, s.tipo_sitio)}`
    );
  });
  const block =
    `▸ ${sitios.length} sitio(s) DESCONECTADO(s) (> ${DESCONEXION_HORAS}h sin enviar datos):\n` +
    lines.join('\n');
  return { count: sitios.length, block, sig: `F:${sitios.map((s) => s.id).join(',')}` };
}

export async function runReconcilerCycle(): Promise<void> {
  beat('dgaReconciler');
  try {
    const stuck = await reconcileStuckEnviando();
    const driftEnviado = await reconcileDriftEnviado();
    const sinAudit = await reportEnviadoSinAudit();
    const doubles = await reportDoubleSubmission();
    const stale = await reportVacioStale();
    const desconectados = await reportSitiosDesconectados();

    // Un SOLO correo por ciclo con TODO (envío DGA + reconciler + desconexión):
    // se juntan las categorías con hallazgos en un digest, con throttle único
    // (no reenvía si el conjunto no cambió). Los sitios traen link clickeable.
    const parts = [desconectados, stale, sinAudit, doubles].filter((p) => p.block);
    if (parts.length > 0) {
      const signature = parts.map((p) => p.sig).join('||');
      if (signature !== lastDigestSignature) {
        lastDigestSignature = signature;
        const total = desconectados.count + stale.count + sinAudit.count + doubles.count;
        await sendDgaAdminAlert({
          subject: `[DGA] Resumen: ${total} hallazgo(s) en ${parts.length} categoría(s)`,
          body:
            `Resumen de monitoreo (envío DGA + reconciler + desconexión de sitios). ` +
            `Todo en un solo correo para evitar spam; llega uno nuevo solo cuando el ` +
            `conjunto de hallazgos cambia. Los sitios son clickeables (requieren sesión).\n\n` +
            parts.map((p) => p.block).join('\n\n────────────────────\n\n'),
        });
      } else {
        logger.debug('DGA reconciler: digest sin cambios, skip alerta');
      }
    } else {
      lastDigestSignature = '';
    }

    if (
      stuck > 0 ||
      driftEnviado > 0 ||
      sinAudit.count > 0 ||
      doubles.count > 0 ||
      stale.count > 0 ||
      desconectados.count > 0
    ) {
      logger.info(
        {
          stuck_unlocked: stuck,
          drift_enviado_fixed: driftEnviado,
          enviado_sin_audit: sinAudit.count,
          double_submission: doubles.count,
          vacio_stale: stale.count,
          sitios_desconectados: desconectados.count,
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
