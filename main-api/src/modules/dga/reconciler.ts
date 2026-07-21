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
import { renderAdminShell, sendDgaAdminAlert } from './notifier';

// Base del frontend para links clickeables en el mail (no navega si no hay
// sesión, pero deja el sitio a un click una vez logueado).
const FRONTEND_BASE = (process.env.FRONTEND_URL || 'https://nuevacloud.emeltec.cl/login').replace(
  /\/login\/?$/,
  '',
);
// tipo_sitio → segmento de ruta del detalle (ver frontend site-type-ui.ts).
// tipo_sitio → segmento de ruta del detalle (espejo de frontend site-type-ui).
const TIPO_RUTA: Record<string, string> = {
  pozo: 'water',
  vertiente: 'vertiente',
  canal: 'canal',
  electrico: 'electric',
  riles: 'riles',
  camara_frio: 'cold-room',
  proceso: 'process',
  pasteurizador: 'pasteurizador',
  generico: 'generic',
  maleta: 'generic',
};
function siteUrl(siteId: string, tipo: string): string {
  // Fallback 'generic' (ruta existente) para tipos desconocidos, no 'water'.
  const seg = TIPO_RUTA[tipo] ?? 'generic';
  return `${FRONTEND_BASE}/companies/${siteId}/${seg}`;
}

// ---- Helpers de HTML para el correo (inline styles, compatible con clientes) ----
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function siteBtn(url: string): string {
  return (
    `<a href="${url}" style="display:inline-block;padding:5px 12px;background:#0DAFBD;` +
    `color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700;` +
    `font-family:Arial,sans-serif;">Ver sitio →</a>`
  );
}
function cardHtml(heading: string, color: string, bodyHtml: string): string {
  return (
    `<div style="border:1px solid #E2E8F0;border-left:4px solid ${color};border-radius:8px;` +
    `padding:14px 16px;margin:0 0 16px;background:#FFFFFF;">` +
    `<p style="margin:0 0 12px;font-weight:700;font-size:14px;color:#1E293B;">${esc(heading)}</p>` +
    bodyHtml +
    `</div>`
  );
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
  html: string | null;
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
  if (orphans.length === 0) return { count: 0, block: null, html: null, sig: '' };
  const lines = orphans
    .slice(0, 50)
    .map((o) => `  - site=${o.site_id} ts=${o.ts} comprobante=${o.comprobante ?? '(null)'}`);
  const block =
    `▸ ${orphans.length} slot(s) en estado 'enviado' SIN registro en dga_send_audit.\n` +
    `  Causas: import legacy, fix manual del admin, bug en submission. ` +
    `Acción: revisar manualmente (NO se auto-corrige).\n` +
    `  Primeros ${Math.min(orphans.length, 50)}:\n` +
    lines.join('\n');
  const htmlRows = orphans
    .slice(0, 50)
    .map(
      (o) =>
        `<li style="margin:2px 0;font-family:monospace;font-size:12px;color:#475569;">` +
        `${esc(o.site_id)} · ${esc(o.ts)} · comprob. ${esc(o.comprobante ?? '(null)')}</li>`,
    )
    .join('');
  const html = cardHtml(
    `${orphans.length} envío(s) sin auditoría`,
    '#F87171',
    `<p style="margin:0 0 8px;font-size:13px;color:#64748B;">Slots 'enviado' sin registro en ` +
      `dga_send_audit. Revisar manualmente (no se auto-corrige).</p>` +
      `<ul style="margin:0;padding-left:18px;">${htmlRows}</ul>`,
  );
  return {
    count: orphans.length,
    block,
    html,
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
  if (doubles.length === 0) return { count: 0, block: null, html: null, sig: '' };
  const lines = doubles
    .slice(0, 50)
    .map((d) => `  - site=${d.site_id} ts=${d.ts} envíos_OK=${d.ok_count}`);
  const block =
    `▸ ${doubles.length} slot(s) con 2+ audits OK (status='00') a SNIA — posible doble envío ` +
    `(puede activar bloqueo del Centro de Control, Res 2170 §6.3).\n` +
    `  Acción: verificar en MIA-DGA. Si es bug, revisar lock del submission.\n` +
    `  Primeros ${Math.min(doubles.length, 50)}:\n` +
    lines.join('\n');
  const htmlRows = doubles
    .slice(0, 50)
    .map(
      (d) =>
        `<li style="margin:2px 0;font-family:monospace;font-size:12px;color:#475569;">` +
        `${esc(d.site_id)} · ${esc(d.ts)} · envíos OK: ${esc(d.ok_count)}</li>`,
    )
    .join('');
  const html = cardHtml(
    `${doubles.length} posible(s) doble(s) envío(s) a SNIA`,
    '#F87171',
    `<p style="margin:0 0 8px;font-size:13px;color:#64748B;">2+ audits OK — puede activar bloqueo ` +
      `del Centro de Control (Res 2170 §6.3). Verificar en MIA-DGA.</p>` +
      `<ul style="margin:0;padding-left:18px;">${htmlRows}</ul>`,
  );
  return {
    count: doubles.length,
    block,
    html,
    sig: `D:${doubles.map((d) => d.site_id + d.ts).join(',')}`,
  };
}

// Cadencia del digest: se envía en horarios fijos (hora Chile), por defecto
// 3 veces al día (08, 14, 20). El reconciler igual corre cada 1h para los
// auto-fixes; solo el CORREO se agenda. Dedup por slot (fecha+hora) para no
// repetir dentro de la misma hora objetivo. Resetea al reiniciar el proceso.
const DIGEST_HOURS = String(process.env.DGA_DIGEST_HOURS ?? '8,14,20')
  .split(',')
  .map((h) => parseInt(h.trim(), 10))
  .filter((h) => Number.isFinite(h) && h >= 0 && h <= 23);
let lastDigestSlot = '';

/** Fecha (YYYY-MM-DD) y hora (0-23) actuales en zona horaria de Chile. */
function chileSlot(): { hour: number; slot: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = parseInt(get('hour'), 10) % 24;
  const slot = `${get('year')}-${get('month')}-${get('day')}:${hour}`;
  return { hour, slot };
}

async function reportVacioStale(): Promise<AlertPart> {
  const stale = await listVacioSlotsStale(STALE_VACIO_HOURS);
  if (stale.length === 0) {
    return { count: 0, block: null, html: null, sig: '' };
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
  const htmlSites = [...bySite.entries()]
    .map(
      ([siteId, slots]) =>
        `<li style="margin:4px 0;font-size:13px;color:#475569;">` +
        `<span style="font-family:monospace;">${esc(siteId)}</span> — ${slots.length} slot(s) &nbsp;` +
        siteBtn(siteUrl(siteId, 'pozo')) +
        `</li>`,
    )
    .join('');
  const html = cardHtml(
    `${stale.length} slot(s) DGA sin dato (> ${STALE_VACIO_HOURS}h)`,
    '#FBBF24',
    `<p style="margin:0 0 8px;font-size:13px;color:#64748B;">El fill worker no encuentra el ` +
      `bucket. No se reporta a DGA hasta que llegue el dato.</p>` +
      `<ul style="margin:0;padding-left:18px;">${htmlSites}</ul>`,
  );
  return {
    count: stale.length,
    block,
    html,
    sig: `E:${stale.map((s) => `${s.site_id}:${s.ts}`).join('|')}`,
  };
}

const DESCONEXION_HORAS = Number(process.env.DGA_DESCONEXION_HORAS ?? STALE_VACIO_HOURS);

/** Sitios que dejaron de enviar datos hace > DESCONEXION_HORAS. */
async function reportSitiosDesconectados(): Promise<AlertPart> {
  const sitios = await listSitiosDesconectados(DESCONEXION_HORAS);
  if (sitios.length === 0) return { count: 0, block: null, html: null, sig: '' };
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
  const rows = sitios
    .slice(0, 50)
    .map((s) => {
      const scope = [s.empresa, s.sub_empresa].filter(Boolean).join(' / ') || '—';
      return (
        `<tr>` +
        `<td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#1E293B;font-weight:600;">${esc(s.descripcion)}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;color:#64748B;">${esc(scope)}</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;font-size:13px;color:#DC2626;font-weight:700;white-space:nowrap;">${Number(s.horas).toFixed(1)}h</td>` +
        `<td style="padding:7px 8px;border-bottom:1px solid #E2E8F0;text-align:right;">${siteBtn(siteUrl(s.id, s.tipo_sitio))}</td>` +
        `</tr>`
      );
    })
    .join('');
  const html = cardHtml(
    `${sitios.length} sitio(s) desconectado(s) (> ${DESCONEXION_HORAS}h sin datos)`,
    '#DC2626',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
      `<tr>` +
      `<th align="left" style="padding:0 8px 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#94A3B8;">Sitio</th>` +
      `<th align="left" style="padding:0 8px 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#94A3B8;">Empresa / Sub</th>` +
      `<th align="left" style="padding:0 8px 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#94A3B8;">Sin datos</th>` +
      `<th></th>` +
      `</tr>${rows}</table>`,
  );
  return { count: sitios.length, block, html, sig: `F:${sitios.map((s) => s.id).join(',')}` };
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

    // Un SOLO correo con TODO (envío DGA + reconciler + desconexión), enviado en
    // horarios fijos (DIGEST_HOURS, hora Chile) → por defecto 3 veces al día.
    // Los sitios traen link clickeable. Si no hay hallazgos en el horario, no
    // se manda "todo OK" (evita ruido).
    const parts = [desconectados, stale, sinAudit, doubles].filter((p) => p.block);
    const { hour, slot } = chileSlot();
    const enHorario = DIGEST_HOURS.includes(hour);
    if (parts.length > 0 && enHorario && slot !== lastDigestSlot) {
      lastDigestSlot = slot;
      const total = desconectados.count + stale.count + sinAudit.count + doubles.count;
      const horarios = DIGEST_HOURS.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ');
      const text =
        `Resumen de monitoreo (envío DGA + reconciler + desconexión de sitios). ` +
        `Se envía en horarios fijos (${horarios} hora Chile) para no spamear. ` +
        `Los sitios son clickeables (requieren sesión).\n\n` +
        parts.map((p) => p.block).join('\n\n────────────────────\n\n');
      // Cuerpo HTML: encabezado + una card por categoría.
      const inner =
        `<tr><td style="padding:26px 32px 8px;">` +
        `<h1 style="margin:0;font-size:19px;color:#1E293B;">Resumen de monitoreo</h1>` +
        `<p style="margin:6px 0 0;font-size:13px;color:#64748B;">` +
        `${total} hallazgo(s) en ${parts.length} categoría(s) · Envíos ${horarios} (Chile)</p>` +
        `</td></tr>` +
        `<tr><td style="padding:8px 32px 26px;">${parts.map((p) => p.html ?? '').join('')}</td></tr>`;
      const html = renderAdminShell({
        title: `Resumen de monitoreo — ${total} hallazgo(s)`,
        preheader: `${total} hallazgo(s) en ${parts.length} categoría(s)`,
        contentHtml: inner,
      });
      await sendDgaAdminAlert({
        subject: `[DGA] Resumen: ${total} hallazgo(s) en ${parts.length} categoría(s)`,
        body: text,
        ...(html ? { html } : {}),
      });
    } else if (parts.length > 0) {
      logger.debug({ hour, enHorario }, 'DGA reconciler: hallazgos fuera de horario de digest');
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
