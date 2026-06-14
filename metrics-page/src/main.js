import {
  Activity,
  Clock,
  Cpu,
  Database,
  GitBranch,
  Globe,
  HardDrive,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  Network,
  Radio,
  RadioTower,
  RefreshCw,
  Server,
  ShieldCheck,
  createIcons,
} from 'lucide';

const icons = {
  Activity,
  Clock,
  Cpu,
  Database,
  GitBranch,
  Globe,
  HardDrive,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  Network,
  Radio,
  RadioTower,
  RefreshCw,
  Server,
  ShieldCheck,
};

const TOKEN_KEY = 'emeltec_metrics_token';
const USER_KEY = 'emeltec_metrics_user';
const HISTORY_KEY = 'emeltec_metrics_history';
const HISTORY_LEN = 30;

// Catálogo de servicios sondeados por /api/status (público) y /api/status/detail
// (autenticado). `pipeline` es el alias público de csvconsumer.
const SERVICE_META = {
  api: { label: 'main-api', role: 'REST público · Node', icon: 'server', path: ':3000' },
  auth: { label: 'auth-api', role: 'JWT · OTP · lockout', icon: 'shield-check', path: ':3001' },
  database: {
    label: 'Base de datos',
    role: 'Persistencia operativa',
    icon: 'database',
    path: ':5433',
  },
  pipeline: {
    label: 'Ingesta gRPC',
    role: 'csvconsumer · Rust',
    icon: 'git-branch',
    path: ':50051',
  },
  csvconsumer: {
    label: 'csvconsumer',
    role: 'Ingesta CSV · Rust',
    icon: 'git-branch',
    path: ':50051',
  },
  ftpconsumer: {
    label: 'ftpconsumer',
    role: 'Ingesta FTP · Rust',
    icon: 'git-branch',
    path: ':50061',
  },
  redis: { label: 'Redis', role: 'Caché de estado', icon: 'hard-drive', path: 'cache' },
};

// Servicios de la arquitectura que main-api NO puede sondear directamente.
// Se muestran como contexto (sin estado en vivo) para dar el panorama completo.
const CONTEXT_SERVICES = [
  {
    label: 'Nginx',
    role: 'TLS · proxy *.emeltec.cl',
    icon: 'globe',
    zone: 'VM Linux',
    path: ':443',
  },
  {
    label: 'Frontend Angular',
    role: 'UI de la plataforma',
    icon: 'globe',
    zone: 'VM Linux',
    path: 'cloud.emeltec.cl',
  },
  {
    label: 'linux-db-api',
    role: 'Cola de comandos PLC · Rust',
    icon: 'network',
    zone: 'VM Linux',
    path: ':3010',
  },
  {
    label: 'csvprocessor',
    role: 'Extrae id_serial · Go',
    icon: 'cpu',
    zone: 'Windows Server',
    path: 'SQLite',
  },
  {
    label: 'MT / PLC',
    role: 'Telemetría en terreno',
    icon: 'radio-tower',
    zone: 'Campo / OT',
    path: 'id_serial',
  },
];

const STATUS_TONE = {
  online: {
    label: 'Operativo',
    color: 'var(--color-success)',
    bg: 'var(--color-success-bg)',
    border: 'var(--color-success-border)',
  },
  degraded: {
    label: 'Degradado',
    color: 'var(--color-warning)',
    bg: 'var(--color-warning-bg)',
    border: 'var(--color-warning-border)',
  },
  offline: {
    label: 'Caido',
    color: 'var(--color-danger)',
    bg: 'var(--color-danger-bg)',
    border: 'var(--color-danger-border)',
  },
  unknown: {
    label: 'No sondeado',
    color: 'var(--text-muted)',
    bg: 'rgba(74,90,114,0.12)',
    border: 'var(--border-default)',
  },
};

const root = document.getElementById('root');

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  user: readJson(USER_KEY) || null,
  history: readJson(HISTORY_KEY) || {},
  payload: null, // /api/status (público)
  detail: null, // /api/status/detail (autenticado)
  detailForbidden: false,
  lastUpdate: Date.now(),
  loading: false,
  error: '',
  now: Date.now(),
  // login UI
  loginOpen: false,
  loginStep: 'password', // 'password' | 'otp'
  challengeToken: '',
  loginEmail: '',
  loginError: '',
  loginBusy: false,
};

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

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
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(seconds % 60).padStart(2, '0')}s`;
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

// ---------- gráficos ----------

// Mini línea SVG de latencia a partir del historial real del servicio.
function latencyChart(values, color, height = 36, width = 120) {
  const series = values.filter((v) => v != null);
  if (series.length < 2) {
    return `<div style="height:${height}px;display:flex;align-items:center;font:500 11px var(--font-body);color:var(--text-muted);">Recolectando…</div>`;
  }
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const span = max - min || 1;
  const step = width / (series.length - 1);
  const points = series
    .map((v, i) => {
      const x = i * step;
      const y = height - 4 - ((v - min) / span) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = series[series.length - 1];
  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      <polyline points="0,${height} ${points} ${width},${height}" fill="${color}" opacity="0.08" stroke="none" />
    </svg>
    <div style="font:600 11px var(--font-mono);color:${color};margin-top:2px;">${last} ms</div>
  `;
}

// Anillo de disponibilidad (online / total).
function availabilityRing(online, total) {
  const pct = total ? Math.round((online / total) * 100) : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color =
    pct === 100
      ? 'var(--color-success)'
      : pct >= 60
        ? 'var(--color-warning)'
        : 'var(--color-danger)';
  return `
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="var(--border-default)" stroke-width="7" />
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 36 36)" />
      <text x="36" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="16" font-weight="600" fill="var(--text-primary)">${pct}%</text>
    </svg>
  `;
}

// ---------- selección de datos según sesión ----------

function isAuthed() {
  return !!state.token && !!state.detail && !state.detailForbidden;
}

function activeServices() {
  if (isAuthed()) return state.detail.services || {};
  return state.payload?.services || {};
}

function getSummary(services) {
  const values = Object.values(services);
  return {
    total: values.length,
    online: values.filter((s) => s.status === 'online').length,
    degraded: values.filter((s) => s.status === 'degraded').length,
    offline: values.filter((s) => s.status === 'offline').length,
  };
}

function getOverall(summary) {
  if (isAuthed() && state.detail?.overall) return state.detail.overall;
  if (!state.payload && !state.detail) return 'degraded';
  if (summary.offline > 0) return 'offline';
  if (summary.degraded > 0) return 'degraded';
  return 'online';
}

function avgLatency(services) {
  const values = Object.values(services)
    .map((s) => s.response_time_ms)
    .filter((v) => v != null);
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// ---------- componentes de UI ----------

function topBar(summary, services) {
  const lat = avgLatency(services);
  const sessionBtn = state.token
    ? `<button id="logoutBtn" type="button" class="btn ghost">${icon('log-out', 15)} Salir</button>`
    : `<button id="loginToggle" type="button" class="btn primary">${icon('log-in', 15)} Iniciar sesión</button>`;
  return `
    <header style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;">
      <div>
        <div class="label">EMELTEC CLOUD</div>
        <h1 style="margin-top:6px;font:600 30px/1.1 var(--font-display);color:var(--text-primary);">Panel de salud operativa</h1>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${metricChip('Servicios', summary.total)}
        ${metricChip('Online', summary.online, 'var(--color-success)')}
        ${lat != null ? metricChip('Latencia prom.', `${lat} ms`, 'var(--color-primary)') : ''}
        ${sessionBtn}
      </div>
    </header>
  `;
}

function metricChip(label, value, color = 'var(--text-primary)') {
  return `
    <div style="min-width:104px;padding:10px 12px;border:1px solid var(--border-default);border-radius:10px;background:var(--bg-surface);box-shadow:var(--shadow-xs);">
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
      <div style="padding:24px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:20px;align-items:center;">
        <div>${availabilityRing(summary.online, summary.total)}</div>
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">${statusPill(overall)}</div>
          <h2 style="font:600 26px/1.15 var(--font-display);color:var(--text-primary);">${title}</h2>
          <p style="margin-top:8px;font:400 14px/1.6 var(--font-body);color:var(--text-secondary);">${detail}</p>
        </div>
        <button id="refreshBtn" type="button" class="btn ghost" style="align-self:flex-start;">
          <span class="${state.loading ? 'spin' : ''}">${icon('refresh-cw', 15)}</span> Actualizar
        </button>
      </div>
      <div style="padding:0 24px 18px;display:flex;gap:16px;flex-wrap:wrap;color:var(--text-secondary);font:400 12px var(--font-body);">
        <span>${icon('clock', 13)} Ultima verificacion ${fmtTime(state.lastUpdate)} · ${fmtAge(state.now - state.lastUpdate)}</span>
        <span>${icon('radio', 13)} Sondeo automatico cada 10 s</span>
        ${isAuthed() ? `<span>${icon('shield-check', 13)} Sesión: ${escapeHtml(state.user?.email || '')} (${escapeHtml(state.user?.tipo || '')})</span>` : ''}
      </div>
    </section>
  `;
}

function serviceCard(id, data) {
  const meta = SERVICE_META[id] || { label: id, role: id, icon: 'cpu', path: id };
  const tone = STATUS_TONE[data.status] || STATUS_TONE.offline;
  const color = tone.color;
  const authed = isAuthed();

  const metrics = [
    data.response_time_ms != null ? ['Latencia', `${data.response_time_ms} ms`] : null,
    data.uptime_s != null ? ['Uptime', fmtUptime(data.uptime_s)] : null,
    data.environment ? ['Entorno', data.environment] : null,
    data.version ? ['Versión', data.version] : null,
    data.node_version ? ['Node', data.node_version] : null,
    data.http_status != null ? ['HTTP', data.http_status] : null,
  ].filter(Boolean);

  const chart = authed
    ? `<div style="padding:0 16px 14px;">${latencyChart(state.history[id] || [], color)}</div>`
    : '';

  return `
    <article style="border:1px solid ${data.status === 'online' ? 'var(--border-default)' : tone.border};border-radius:12px;background:var(--bg-surface);box-shadow:${data.status === 'online' ? 'var(--shadow-xs)' : 'var(--shadow-teal-sm)'};overflow:hidden;">
      <div style="padding:16px;display:flex;justify-content:space-between;gap:14px;">
        <div style="display:flex;gap:12px;min-width:0;">
          <div style="width:38px;height:38px;border-radius:10px;display:grid;place-items:center;color:${color};background:${tone.bg};border:1px solid ${tone.border};">${icon(meta.icon, 18)}</div>
          <div style="min-width:0;">
            <h3 style="font:600 16px/1.2 var(--font-display);color:var(--text-primary);">${escapeHtml(meta.label)}</h3>
            <p style="margin-top:3px;font:400 12px/1.4 var(--font-body);color:var(--text-secondary);">${escapeHtml(meta.role)}</p>
          </div>
        </div>
        ${statusPill(data.status)}
      </div>
      ${
        authed && metrics.length
          ? `<div style="padding:0 16px 12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">${metrics.map(([k, v]) => metricCell(k, v)).join('')}</div>`
          : ''
      }
      ${chart}
      <div style="padding:12px 16px;border-top:1px solid var(--border-muted);display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <span style="font:500 12px var(--font-mono);color:var(--text-secondary);">${escapeHtml(meta.path)}</span>
        ${data.error && authed ? `<span style="font:500 11px var(--font-body);color:var(--color-danger);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px;" title="${escapeHtml(data.error)}">${escapeHtml(data.error)}</span>` : ''}
      </div>
    </article>
  `;
}

function metricCell(label, value) {
  return `
    <div style="padding:10px;border:1px solid var(--border-muted);border-radius:8px;background:var(--bg-base);">
      <div class="label" style="font-size:9px;">${escapeHtml(label)}</div>
      <div style="margin-top:4px;font:600 14px var(--font-mono);color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(value)}</div>
    </div>
  `;
}

function contextSection() {
  const cards = CONTEXT_SERVICES.map(
    (s) => `
      <article style="border:1px dashed var(--border-default);border-radius:12px;background:var(--bg-surface);padding:14px 16px;opacity:.85;">
        <div style="display:flex;gap:12px;align-items:center;">
          <div style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center;color:var(--text-muted);background:rgba(74,90,114,0.12);border:1px solid var(--border-default);">${icon(s.icon, 16)}</div>
          <div style="min-width:0;">
            <h3 style="font:600 14px/1.2 var(--font-display);color:var(--text-primary);">${escapeHtml(s.label)}</h3>
            <p style="margin-top:2px;font:400 11px/1.4 var(--font-body);color:var(--text-secondary);">${escapeHtml(s.role)}</p>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font:500 11px var(--font-mono);color:var(--text-muted);">${escapeHtml(s.zone)} · ${escapeHtml(s.path)}</span>
          ${statusPill('unknown')}
        </div>
      </article>
    `,
  ).join('');
  return `
    <div style="height:28px"></div>
    <div class="label" style="font-size:11px;margin-bottom:6px;">Contexto de arquitectura</div>
    <p style="font:400 12px var(--font-body);color:var(--text-secondary);margin-bottom:14px;max-width:70ch;">
      Servicios que main-api no sondea directamente (estáticos o del lado Windows). Se listan para dar el panorama completo del flujo de datos.
    </p>
    <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;">${cards}</section>
  `;
}

function loginPanel() {
  if (!state.loginOpen || state.token) return '';
  const isOtp = state.loginStep === 'otp';
  return `
    <div id="loginOverlay" style="position:fixed;inset:0;background:var(--bg-overlay);backdrop-filter:blur(3px);display:grid;place-items:center;z-index:50;padding:20px;">
      <form id="loginForm" style="width:100%;max-width:380px;border:1px solid var(--border-default);border-radius:16px;background:var(--bg-surface);box-shadow:var(--shadow-xl);padding:24px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:var(--color-primary);background:var(--color-primary-bg);border:1px solid var(--color-primary-border);">${icon(isOtp ? 'key-round' : 'shield-check', 18)}</div>
          <h2 style="font:600 18px var(--font-display);color:var(--text-primary);">${isOtp ? 'Verificación 2FA' : 'Acceso operativo'}</h2>
        </div>
        <p style="font:400 12px/1.5 var(--font-body);color:var(--text-secondary);margin-bottom:16px;">
          ${isOtp ? 'Ingresa el código enviado a tu correo para completar el ingreso.' : 'Inicia sesión para ver el detalle operativo (latencia, uptime, entorno).'}
        </p>
        ${
          isOtp
            ? `<label class="fld">${icon('key-round', 14)}<input name="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="Código OTP" required /></label>`
            : `
          <label class="fld">${icon('mail', 14)}<input name="email" type="email" autocomplete="username" placeholder="Correo" value="${escapeHtml(state.loginEmail)}" required /></label>
          <label class="fld">${icon('key-round', 14)}<input name="password" type="password" autocomplete="current-password" placeholder="Contraseña" required /></label>
        `
        }
        ${state.loginError ? `<div style="margin:4px 0 12px;padding:9px 11px;border:1px solid var(--color-danger-border);border-radius:8px;background:var(--color-danger-bg);color:var(--color-danger);font:500 12px var(--font-body);">${escapeHtml(state.loginError)}</div>` : ''}
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button type="submit" class="btn primary" style="flex:1;justify-content:center;" ${state.loginBusy ? 'disabled' : ''}>
            ${state.loginBusy ? `<span class="spin">${icon('refresh-cw', 15)}</span>` : icon('log-in', 15)} ${isOtp ? 'Verificar' : 'Entrar'}
          </button>
          <button type="button" id="loginCancel" class="btn ghost">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function render() {
  const services = activeServices();
  const summary = getSummary(services);
  const overall = getOverall(summary);

  const forbiddenBanner = state.detailForbidden
    ? `<div style="margin-top:16px;padding:12px 14px;border:1px solid var(--color-warning-border);border-radius:10px;background:var(--color-warning-bg);color:var(--color-warning);font:500 13px var(--font-body);">Tu rol no tiene acceso al detalle operativo. Mostrando la vista pública.</div>`
    : '';

  root.innerHTML = `
    <main style="min-height:100vh;padding:32px 36px 60px;max-width:1280px;margin:0 auto;">
      ${topBar(summary, services)}
      <div style="height:24px"></div>
      ${hero(summary, overall)}
      ${forbiddenBanner}
      ${state.error ? `<div style="margin-top:16px;padding:12px 14px;border:1px solid var(--color-danger-border);border-radius:10px;background:var(--color-danger-bg);color:var(--color-danger);font:500 13px var(--font-body);">${escapeHtml(state.error)}</div>` : ''}
      <div style="height:28px"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
        <div class="label" style="font-size:11px;">${isAuthed() ? 'Servicios monitoreados (detalle en vivo)' : 'Servicios monitoreados'}</div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          ${legend('online')} ${legend('degraded')} ${legend('offline')}
        </div>
      </div>
      <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
        ${
          Object.entries(services)
            .map(([id, data]) => serviceCard(id, data))
            .join('') || emptyState()
        }
      </section>
      ${isAuthed() ? contextSection() : ''}
      ${!state.token ? loginHint() : ''}
    </main>
    ${loginPanel()}
  `;
  createIcons({ icons });
  wireEvents();
}

function loginHint() {
  return `
    <div style="margin-top:28px;padding:16px 18px;border:1px dashed var(--border-default);border-radius:12px;background:var(--bg-surface);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span style="color:var(--color-primary);">${icon('activity', 18)}</span>
      <span style="font:400 13px var(--font-body);color:var(--text-secondary);flex:1;min-width:200px;">
        Estás viendo el estado público. Inicia sesión como operador para ver latencia, uptime, entorno y el inventario completo con gráficos.
      </span>
      <button id="loginToggle2" type="button" class="btn primary">${icon('log-in', 15)} Iniciar sesión</button>
    </div>
  `;
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

// ---------- eventos ----------

function wireEvents() {
  document.getElementById('refreshBtn')?.addEventListener('click', () => poll(true));
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  const openLogin = () => {
    state.loginOpen = true;
    state.loginStep = 'password';
    state.loginError = '';
    render();
  };
  document.getElementById('loginToggle')?.addEventListener('click', openLogin);
  document.getElementById('loginToggle2')?.addEventListener('click', openLogin);
  document.getElementById('loginCancel')?.addEventListener('click', () => {
    state.loginOpen = false;
    state.loginError = '';
    render();
  });
  document.getElementById('loginForm')?.addEventListener('submit', onLoginSubmit);
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  state.loginBusy = true;
  state.loginError = '';
  render();

  try {
    let body;
    if (state.loginStep === 'otp') {
      const otp = form.otp.value.trim();
      body = {
        email: state.loginEmail,
        otp_code: otp,
        mode: 'mfa',
        challenge_token: state.challengeToken,
      };
    } else {
      state.loginEmail = form.email.value.trim();
      body = { email: state.loginEmail, password: form.password.value, mode: 'password' };
    }

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.requires_otp) {
      state.loginStep = 'otp';
      state.challengeToken = data.challenge_token;
      state.loginBusy = false;
      render();
      return;
    }

    if (!res.ok || !data.token) {
      state.loginError = data.error || 'No se pudo iniciar sesión.';
      state.loginBusy = false;
      render();
      return;
    }

    // éxito
    state.token = data.token;
    state.user = data.user || null;
    localStorage.setItem(TOKEN_KEY, state.token);
    if (state.user) localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    state.loginOpen = false;
    state.loginBusy = false;
    state.loginStep = 'password';
    state.challengeToken = '';
    state.detailForbidden = false;
    render();
    poll(true);
  } catch (err) {
    state.loginError = `Error de red: ${err.message}`;
    state.loginBusy = false;
    render();
  }
}

function logout(message) {
  state.token = '';
  state.user = null;
  state.detail = null;
  state.detailForbidden = false;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  if (typeof message === 'string') state.error = message;
  render();
  poll(true);
}

// ---------- sondeo ----------

function recordHistory(services) {
  for (const [id, data] of Object.entries(services)) {
    const arr = state.history[id] || [];
    arr.push(data.response_time_ms ?? null);
    while (arr.length > HISTORY_LEN) arr.shift();
    state.history[id] = arr;
  }
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch {
    /* almacenamiento lleno — el historial es best-effort */
  }
}

async function poll(manual = false) {
  state.loading = manual;
  state.error = '';
  if (manual) render();

  // Vista pública siempre disponible.
  try {
    const res = await fetch('/api/status', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`);
    state.payload = await res.json();
    state.lastUpdate = new Date(state.payload.timestamp || Date.now()).getTime();
  } catch (err) {
    state.error = `No se pudo consultar /api/status: ${err.message}`;
  }

  // Detalle autenticado si hay token.
  if (state.token) {
    try {
      const res = await fetch('/api/status/detail', {
        cache: 'no-store',
        headers: { Accept: 'application/json', Authorization: `Bearer ${state.token}` },
      });
      if (res.status === 401) {
        logout('Tu sesión expiró. Inicia sesión nuevamente.');
        return;
      }
      if (res.status === 403) {
        state.detailForbidden = true;
        state.detail = null;
      } else if (res.ok || res.status === 207) {
        state.detail = await res.json();
        state.detailForbidden = false;
        state.lastUpdate = new Date(state.detail.timestamp || Date.now()).getTime();
        recordHistory(state.detail.services || {});
      }
    } catch (err) {
      state.error = `No se pudo consultar /api/status/detail: ${err.message}`;
    }
  }

  state.loading = false;
  render();
}

setInterval(() => {
  state.now = Date.now();
  // Solo refresca el "hace Xs" sin recalcular todo si hay un modal abierto.
  if (!state.loginOpen) render();
}, 1000);

setInterval(() => poll(false), 10000);
render();
poll(false);
