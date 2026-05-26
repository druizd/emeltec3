import {
  Clock,
  Cpu,
  Database,
  GitBranch,
  Radio,
  RadioTower,
  RefreshCw,
  Server,
  ShieldCheck,
  createIcons,
} from 'lucide';

const icons = {
  Clock,
  Cpu,
  Database,
  GitBranch,
  Radio,
  RadioTower,
  RefreshCw,
  Server,
  ShieldCheck,
};

const SERVICE_META = {
  api: { label: 'Main API', role: 'Capa publica REST', icon: 'server', path: '/api/v1' },
  auth: { label: 'Auth Service', role: 'JWT · OAuth2 · Sesiones', icon: 'shield-check', path: '/auth' },
  database: { label: 'Database', role: 'PostgreSQL primaria', icon: 'database', path: 'pg-primary' },
  pipeline: { label: 'Pipeline gRPC', role: 'Ingesta de telemetria', icon: 'git-branch', path: ':50051' },
  dga: { label: 'DGA Reporter', role: 'Envios a DGA · Ministerio', icon: 'radio-tower', path: 'dga.ready' },
};

const STATUS_TONE = {
  online: { label: 'Operativo', color: 'var(--color-success)', bg: 'var(--color-success-bg)', border: 'var(--color-success-border)' },
  degraded: { label: 'Degradado', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)', border: 'var(--color-warning-border)' },
  offline: { label: 'Caido', color: 'var(--color-danger)', bg: 'var(--color-danger-bg)', border: 'var(--color-danger-border)' },
};

const root = document.getElementById('root');
const state = {
  payload: null,
  lastUpdate: Date.now(),
  loading: false,
  error: '',
  now: Date.now(),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtUptime(seconds) {
  if (seconds == null) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function fmtAge(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  return `hace ${Math.floor(minutes / 60)}h`;
}

function fmtTime(value) {
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function icon(name, size = 16) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
}

function statusDot(status, size = 8) {
  const tone = STATUS_TONE[status] || STATUS_TONE.offline;
  const pulse = status === 'online' ? 'pulse-dot' : '';
  return `<span class="${pulse}" style="position:relative;display:inline-block;width:${size}px;height:${size}px;border-radius:9999px;background:${tone.color};color:${tone.color};box-shadow:0 0 0 3px ${tone.bg}"></span>`;
}

function statusPill(status) {
  const tone = STATUS_TONE[status] || STATUS_TONE.offline;
  return `
    <span style="display:inline-flex;align-items:center;gap:7px;padding:5px 10px;border-radius:9999px;border:1px solid ${tone.border};background:${tone.bg};color:${tone.color};font:600 11px var(--font-body);">
      ${statusDot(status, 6)}
      ${tone.label}
    </span>
  `;
}

function sparkline(status, seed) {
  let x = seed;
  const bars = Array.from({ length: 14 }, (_, i) => {
    x = (x * 9301 + 49297) % 233280;
    const v = status === 'offline' ? 0.15 + (x / 233280) * 0.2 : 0.35 + (x / 233280) * 0.65;
    return `<span style="height:${Math.round(v * 22)}px;opacity:${i === 13 ? 1 : 0.45 + v * 0.4}"></span>`;
  }).join('');
  return `<div class="sparkline" aria-hidden="true">${bars}</div>`;
}

function getServices() {
  return state.payload?.services || {};
}

function getSummary() {
  const values = Object.values(getServices());
  return {
    total: values.length,
    online: values.filter((s) => s.status === 'online').length,
    degraded: values.filter((s) => s.status === 'degraded').length,
    offline: values.filter((s) => s.status === 'offline').length,
  };
}

function getOverall(summary) {
  if (!state.payload) return 'degraded';
  if (summary.offline > 0) return 'offline';
  if (summary.degraded > 0) return 'degraded';
  return 'online';
}

function avgLatency() {
  const values = Object.values(getServices())
    .map((service) => service.response_time_ms)
    .filter((value) => value != null);
  if (!values.length) return '-';
  return Math.round(values.reduce((acc, value) => acc + value, 0) / values.length);
}

function topBar(summary) {
  const env = getServices().api?.environment || '-';
  return `
    <header style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
      <div>
        <div class="label">EMELTEC CLOUD</div>
        <h1 style="margin-top:6px;font:600 30px/1.1 var(--font-display);letter-spacing:0;color:var(--text-primary);">Panel de salud operativa</h1>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${metricChip('Servicios', summary.total)}
        ${metricChip('Online', summary.online, 'var(--color-success)')}
        ${metricChip('Latencia prom.', `${avgLatency()} ms`, 'var(--color-primary)')}
        ${metricChip('Entorno', env)}
      </div>
    </header>
  `;
}

function metricChip(label, value, color = 'var(--text-primary)') {
  return `
    <div style="min-width:118px;padding:10px 12px;border:1px solid var(--border-default);border-radius:10px;background:var(--bg-surface);box-shadow:var(--shadow-xs);">
      <div class="label" style="font-size:10px;">${escapeHtml(label)}</div>
      <div style="margin-top:4px;font:600 18px var(--font-mono);color:${color};">${escapeHtml(value)}</div>
    </div>
  `;
}

function hero(summary, overall) {
  const tone = STATUS_TONE[overall] || STATUS_TONE.degraded;
  const title =
    overall === 'online'
      ? 'Todos los sistemas operativos'
      : overall === 'degraded'
        ? 'Operacion con alertas activas'
        : 'Interrupcion detectada';
  const detail =
    overall === 'online'
      ? 'Todos los servicios responden dentro de los umbrales esperados.'
      : overall === 'degraded'
        ? `${summary.degraded} servicio${summary.degraded === 1 ? '' : 's'} en estado degradado.`
        : `${summary.offline} servicio${summary.offline === 1 ? '' : 's'} sin respuesta.`;

  return `
    <section style="position:relative;overflow:hidden;border:1px solid ${tone.border};border-radius:16px;background:linear-gradient(135deg,var(--bg-surface),var(--bg-elevated));box-shadow:var(--shadow-md);">
      <div class="live-bar" style="height:2px;color:${tone.color};opacity:.8"></div>
      <div style="padding:24px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">${statusDot(overall, 10)}${statusPill(overall)}</div>
          <h2 style="font:600 28px/1.15 var(--font-display);letter-spacing:0;color:var(--text-primary);">${title}</h2>
          <p style="margin-top:8px;font:400 14px/1.6 var(--font-body);color:var(--text-secondary);">${detail}</p>
        </div>
        <button id="refreshBtn" type="button" style="height:40px;padding:0 14px;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border-default);border-radius:8px;background:var(--bg-subtle);color:var(--text-primary);font:600 13px var(--font-body);cursor:pointer;">
          <span class="${state.loading ? 'spin' : ''}">${icon('refresh-cw', 15)}</span>
          Actualizar
        </button>
      </div>
      <div style="padding:0 24px 18px;display:flex;gap:16px;flex-wrap:wrap;color:var(--text-secondary);font:400 12px var(--font-body);">
        <span>${icon('clock', 13)} Ultima verificacion ${fmtTime(state.lastUpdate)} · ${fmtAge(state.now - state.lastUpdate)}</span>
        <span>${icon('radio', 13)} Sondeo automatico cada 10 s</span>
      </div>
    </section>
  `;
}

function serviceCard(id, data) {
  const meta = SERVICE_META[id] || { label: id, role: id, icon: 'cpu', path: id };
  const tone = STATUS_TONE[data.status] || STATUS_TONE.offline;
  const metrics = [
    data.response_time_ms != null ? ['Latencia', `${data.response_time_ms} ms`] : null,
    data.uptime_s != null ? ['Uptime', fmtUptime(data.uptime_s)] : null,
    data.environment ? ['Entorno', data.environment] : null,
    data.http_status != null ? ['HTTP', data.http_status] : null,
  ].filter(Boolean);

  return `
    <article style="border:1px solid ${data.status === 'online' ? 'var(--border-default)' : tone.border};border-radius:12px;background:var(--bg-surface);box-shadow:${data.status === 'online' ? 'var(--shadow-xs)' : 'var(--shadow-teal-sm)'};overflow:hidden;">
      <div style="padding:16px;display:flex;justify-content:space-between;gap:14px;">
        <div style="display:flex;gap:12px;min-width:0;">
          <div style="width:38px;height:38px;border-radius:10px;display:grid;place-items:center;color:${tone.color};background:${tone.bg};border:1px solid ${tone.border};">${icon(meta.icon, 18)}</div>
          <div style="min-width:0;">
            <h3 style="font:600 16px/1.2 var(--font-display);letter-spacing:0;color:var(--text-primary);">${escapeHtml(meta.label)}</h3>
            <p style="margin-top:3px;font:400 12px/1.4 var(--font-body);color:var(--text-secondary);">${escapeHtml(meta.role)}</p>
          </div>
        </div>
        ${statusPill(data.status)}
      </div>
      <div style="padding:0 16px 14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
        ${metrics.length ? metrics.map(([k, v]) => metricCell(k, v)).join('') : metricCell('Estado', 'Sin metricas')}
      </div>
      <div style="padding:12px 16px;border-top:1px solid var(--border-muted);display:flex;align-items:center;justify-content:space-between;gap:12px;color:${tone.color};">
        <span style="font:500 12px var(--font-mono);color:var(--text-secondary);">${escapeHtml(meta.path)}</span>
        ${sparkline(data.status, id.length * 17)}
      </div>
      ${data.error ? `<div style="padding:0 16px 14px;color:var(--color-danger);font:400 12px/1.5 var(--font-body);">${escapeHtml(data.error)}</div>` : ''}
    </article>
  `;
}

function metricCell(label, value) {
  return `
    <div style="padding:10px;border:1px solid var(--border-muted);border-radius:8px;background:var(--bg-base);">
      <div class="label" style="font-size:9px;">${escapeHtml(label)}</div>
      <div style="margin-top:4px;font:600 15px var(--font-mono);color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(value)}</div>
    </div>
  `;
}

function rawPayload() {
  return `
    <details style="margin-top:28px;border:1px solid var(--border-default);border-radius:12px;background:var(--bg-surface);overflow:hidden;">
      <summary style="cursor:pointer;padding:14px 16px;font:600 12px var(--font-display);text-transform:uppercase;color:var(--text-secondary);">Payload /api/status</summary>
      <pre style="margin:0;padding:14px 16px;border-top:1px solid var(--border-muted);background:var(--bg-base);overflow:auto;font:400 12px/1.55 var(--font-mono);color:var(--text-secondary);">${escapeHtml(JSON.stringify(state.payload || {}, null, 2))}</pre>
    </details>
  `;
}

function render() {
  const services = getServices();
  const summary = getSummary();
  const overall = getOverall(summary);
  root.innerHTML = `
    <main style="min-height:100vh;padding:32px 36px 60px;max-width:1280px;margin:0 auto;">
      ${topBar(summary)}
      <div style="height:24px"></div>
      ${hero(summary, overall)}
      ${state.error ? `<div style="margin-top:16px;padding:12px 14px;border:1px solid var(--color-danger-border);border-radius:10px;background:var(--color-danger-bg);color:var(--color-danger);font:500 13px var(--font-body);">${escapeHtml(state.error)}</div>` : ''}
      <div style="height:28px"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
        <div class="label" style="font-size:11px;">Servicios monitoreados</div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          ${legend('online')} ${legend('degraded')} ${legend('offline')}
        </div>
      </div>
      <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
        ${Object.entries(services).map(([id, data]) => serviceCard(id, data)).join('') || emptyState()}
      </section>
      ${rawPayload()}
    </main>
  `;
  createIcons({ icons });
  document.getElementById('refreshBtn')?.addEventListener('click', () => fetchStatus(true));
}

function legend(status) {
  const tone = STATUS_TONE[status];
  return `<span style="display:inline-flex;align-items:center;gap:7px;color:var(--text-secondary);font:500 12px var(--font-body);">${statusDot(status, 6)}${tone.label}</span>`;
}

function emptyState() {
  return `
    <div style="grid-column:1/-1;padding:22px;border:1px dashed var(--border-default);border-radius:12px;color:var(--text-secondary);font:500 13px var(--font-body);text-align:center;">
      Esperando respuesta de /api/status.
    </div>
  `;
}

async function fetchStatus(manual = false) {
  state.loading = manual;
  state.error = '';
  render();
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.payload = payload;
    state.lastUpdate = new Date(payload.timestamp || Date.now()).getTime();
  } catch (error) {
    state.error = `No se pudo consultar /api/status: ${error.message}`;
  } finally {
    state.loading = false;
    render();
  }
}

setInterval(() => {
  state.now = Date.now();
  render();
}, 1000);

setInterval(() => fetchStatus(false), 10000);
render();
fetchStatus(false);
