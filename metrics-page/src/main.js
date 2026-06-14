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
const POLL_MS = 10000;

// Servicios sondeados por /api/status (público) y /api/status/detail (autenticado).
// `pipeline` es el alias público de csvconsumer.
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

// Servicios de la arquitectura que main-api NO sondea directamente: se muestran
// como contexto (sin estado en vivo) para dar el panorama completo del flujo.
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

const STATUS = {
  online: { label: 'Operativo', color: 'var(--color-success)' },
  degraded: { label: 'Degradado', color: 'var(--color-warning)' },
  offline: { label: 'Caído', color: 'var(--color-danger)' },
  unknown: { label: 'No sondeado', color: 'var(--text-muted)' },
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
  loginOpen: false,
  loginStep: 'password', // 'password' | 'otp'
  challengeToken: '',
  loginEmail: '',
  loginError: '',
  loginBusy: false,
};

// ---------- utilidades ----------

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusOf(status) {
  return STATUS[status] || STATUS.offline;
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
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.floor(m / 60)}h`;
}

function fmtTime(value) {
  const d = new Date(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function icon(name, size = 16) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
}

// ---------- átomos visuales ----------

function dot(status, size = 8) {
  const { color } = statusOf(status);
  const pulse = status === 'online' ? 'dot--pulse' : '';
  return `<span class="dot ${pulse}" style="width:${size}px;height:${size}px;background:${color};color:${color};box-shadow:0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)"></span>`;
}

function pill(status) {
  const { label } = statusOf(status);
  return `<span class="pill pill--${status in STATUS ? status : 'offline'}">${dot(status, 6)}${label}</span>`;
}

// Gráfico de área de latencia a partir del historial real del servicio.
function latencyChart(values, color) {
  const series = values.filter((v) => v != null);
  if (series.length < 2) {
    return `<div class="card__chart-empty">Recolectando muestras…</div>`;
  }
  const w = 240;
  const h = 40;
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const span = max - min || 1;
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => {
    const x = i * step;
    const y = h - 3 - ((v - min) / span) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const gid = `g${Math.round(min)}_${Math.round(max)}_${series.length}`;
  return `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.28" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="url(#${gid})" stroke="none" />
      <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  `;
}

function availabilityRing(online, total) {
  const pct = total ? Math.round((online / total) * 100) : 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color =
    pct === 100
      ? 'var(--color-success)'
      : pct >= 60
        ? 'var(--color-warning)'
        : 'var(--color-danger)';
  return `
    <svg class="ring" width="84" height="84" viewBox="0 0 84 84" role="img" aria-label="Disponibilidad ${pct}%">
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--border-default)" stroke-width="8" />
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)" />
      <text x="42" y="44" text-anchor="middle" font-size="18">${pct}%</text>
      <text x="42" y="58" text-anchor="middle" font-size="8" fill="var(--text-muted)">DISPONIB.</text>
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

function summarize(services) {
  const v = Object.values(services);
  return {
    total: v.length,
    online: v.filter((s) => s.status === 'online').length,
    degraded: v.filter((s) => s.status === 'degraded').length,
    offline: v.filter((s) => s.status === 'offline').length,
  };
}

function overallStatus(summary) {
  if (isAuthed() && state.detail?.overall) return state.detail.overall;
  if (!state.payload && !state.detail) return 'degraded';
  if (summary.offline > 0) return 'offline';
  if (summary.degraded > 0) return 'degraded';
  return 'online';
}

function avgLatency(services) {
  const v = Object.values(services)
    .map((s) => s.response_time_ms)
    .filter((x) => x != null);
  if (!v.length) return null;
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
}

// ---------- componentes ----------

function chip(label, value, variant = '') {
  const cls = variant ? `chip__value chip__value--${variant}` : 'chip__value';
  return `<div class="chip"><div class="chip__label">${esc(label)}</div><div class="${cls}">${esc(value)}</div></div>`;
}

function topbar(summary, services) {
  const lat = avgLatency(services);
  const session = state.token
    ? `<button id="logoutBtn" class="btn btn--ghost" type="button">${icon('log-out', 15)} Salir</button>`
    : `<button id="loginToggle" class="btn btn--primary" type="button">${icon('log-in', 15)} Iniciar sesión</button>`;
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand__eyebrow">Emeltec Cloud</div>
        <h1 class="brand__title">Panel de salud operativa</h1>
      </div>
      <div class="topbar__actions">
        ${chip('Servicios', summary.total)}
        ${chip('Online', `${summary.online}/${summary.total}`, 'success')}
        ${lat != null ? chip('Latencia prom.', `${lat} ms`, 'primary') : ''}
        ${session}
      </div>
    </header>
  `;
}

function overview(summary, overall) {
  const title =
    overall === 'online'
      ? 'Todos los sistemas operativos'
      : overall === 'degraded'
        ? 'Operación con alertas activas'
        : 'Interrupción detectada';
  const detail =
    overall === 'online'
      ? 'Todos los servicios responden dentro de los umbrales esperados.'
      : overall === 'degraded'
        ? `${summary.degraded} servicio${summary.degraded === 1 ? '' : 's'} en estado degradado.`
        : `${summary.offline} servicio${summary.offline === 1 ? '' : 's'} sin respuesta.`;
  const sessionMeta = isAuthed()
    ? `<span>${icon('shield-check', 13)} Sesión: ${esc(state.user?.email || '')} · ${esc(state.user?.tipo || '')}</span>`
    : '';
  return `
    <section class="overview overview--${overall}">
      <div class="live-bar live-bar--${overall}"></div>
      <div class="overview__body">
        <div>${availabilityRing(summary.online, summary.total)}</div>
        <div>
          ${pill(overall)}
          <h2 class="overview__title">${title}</h2>
          <p class="overview__detail">${detail}</p>
        </div>
        <button id="refreshBtn" class="btn btn--ghost" type="button">
          <span class="${state.loading ? 'spin' : ''}">${icon('refresh-cw', 15)}</span> Actualizar
        </button>
      </div>
      <div class="overview__meta">
        <span>${icon('clock', 13)} Última verificación ${fmtTime(state.lastUpdate)} · ${fmtAge(state.now - state.lastUpdate)}</span>
        <span>${icon('radio', 13)} Sondeo automático cada ${POLL_MS / 1000} s</span>
        ${sessionMeta}
      </div>
    </section>
  `;
}

function serviceCard(id, data) {
  const meta = SERVICE_META[id] || { label: id, role: id, icon: 'cpu', path: id };
  const { color } = statusOf(data.status);
  const authed = isAuthed();
  const cardMod =
    data.status === 'offline' ? 'card--down' : data.status === 'degraded' ? 'card--alert' : '';

  const metrics = [
    data.response_time_ms != null ? ['Latencia', `${data.response_time_ms} ms`] : null,
    data.uptime_s != null ? ['Uptime', fmtUptime(data.uptime_s)] : null,
    data.environment ? ['Entorno', data.environment] : null,
    data.version ? ['Versión', data.version] : null,
    data.node_version ? ['Node', data.node_version] : null,
    data.http_status != null ? ['HTTP', String(data.http_status)] : null,
  ].filter(Boolean);

  const metricsBlock =
    authed && metrics.length
      ? `<div class="card__metrics">${metrics
          .map(
            ([k, v]) =>
              `<div class="metric"><div class="metric__label">${esc(k)}</div><div class="metric__value">${esc(v)}</div></div>`,
          )
          .join('')}</div>`
      : '';

  const series = (state.history[id] || []).filter((v) => v != null);
  const last = series.length ? `${series[series.length - 1]} ms` : '—';
  const chartBlock = authed
    ? `<div class="card__chart">
        <div class="card__chart-head">
          <span class="card__chart-label">Latencia (últimas ${HISTORY_LEN})</span>
          <span class="card__chart-value" style="color:${color}">${last}</span>
        </div>
        ${latencyChart(state.history[id] || [], color)}
      </div>`
    : '';

  return `
    <article class="card ${cardMod}">
      <div class="card__head">
        <div class="card__id">
          <div class="card__icon" style="color:${color};background:color-mix(in srgb, ${color} 14%, transparent);border:1px solid color-mix(in srgb, ${color} 30%, transparent)">${icon(meta.icon, 18)}</div>
          <div>
            <h3 class="card__title">${esc(meta.label)}</h3>
            <p class="card__role">${esc(meta.role)}</p>
          </div>
        </div>
        ${pill(data.status)}
      </div>
      ${metricsBlock}
      ${chartBlock}
      <div class="card__foot">
        <span class="card__path">${esc(meta.path)}</span>
        ${data.error && authed ? `<span class="card__error" title="${esc(data.error)}">${esc(data.error)}</span>` : ''}
      </div>
    </article>
  `;
}

function contextSection() {
  const cards = CONTEXT_SERVICES.map(
    (s) => `
      <article class="ctx-card">
        <div class="ctx-card__head">
          <div class="ctx-card__icon">${icon(s.icon, 16)}</div>
          <div>
            <h3 class="ctx-card__title">${esc(s.label)}</h3>
            <p class="ctx-card__role">${esc(s.role)}</p>
          </div>
        </div>
        <div class="ctx-card__foot">
          <span class="ctx-card__path">${esc(s.zone)} · ${esc(s.path)}</span>
          ${pill('unknown')}
        </div>
      </article>
    `,
  ).join('');
  return `
    <div class="section-head"><div class="section-head__title">Contexto de arquitectura</div></div>
    <p class="section-note">Servicios que main-api no sondea directamente (estáticos o del lado Windows). Se listan para dar el panorama completo del flujo de datos.</p>
    <section class="grid">${cards}</section>
  `;
}

function legendItem(status) {
  return `<span class="legend__item">${dot(status, 6)}${statusOf(status).label}</span>`;
}

function loginHint() {
  return `
    <div class="hint">
      <span style="color:var(--color-primary)">${icon('activity', 18)}</span>
      <span class="hint__text">Estás viendo el estado público. Inicia sesión como operador para ver latencia, uptime, entorno y el inventario completo con gráficos.</span>
      <button id="loginToggle2" class="btn btn--primary" type="button">${icon('log-in', 15)} Iniciar sesión</button>
    </div>
  `;
}

function loginModal() {
  if (!state.loginOpen || state.token) return '';
  const isOtp = state.loginStep === 'otp';
  const fields = isOtp
    ? `<label class="fld">${icon('key-round', 14)}<input name="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="Código OTP" required /></label>`
    : `<label class="fld">${icon('mail', 14)}<input name="email" type="email" autocomplete="username" placeholder="Correo" value="${esc(state.loginEmail)}" required /></label>
       <label class="fld">${icon('key-round', 14)}<input name="password" type="password" autocomplete="current-password" placeholder="Contraseña" required /></label>`;
  return `
    <div class="login" id="loginOverlay">
      <form class="login__panel" id="loginForm">
        <div class="login__head">
          <div class="login__icon">${icon(isOtp ? 'key-round' : 'shield-check', 18)}</div>
          <h2 class="login__title">${isOtp ? 'Verificación 2FA' : 'Acceso operativo'}</h2>
        </div>
        <p class="login__hint">${isOtp ? 'Ingresa el código enviado a tu correo para completar el ingreso.' : 'Inicia sesión para ver el detalle operativo (latencia, uptime, entorno).'}</p>
        ${fields}
        ${state.loginError ? `<div class="alert">${esc(state.loginError)}</div>` : ''}
        <div class="login__actions">
          <button type="submit" class="btn btn--primary" style="flex:1;justify-content:center" ${state.loginBusy ? 'disabled' : ''}>
            ${state.loginBusy ? `<span class="spin">${icon('refresh-cw', 15)}</span>` : icon('log-in', 15)} ${isOtp ? 'Verificar' : 'Entrar'}
          </button>
          <button type="button" id="loginCancel" class="btn btn--ghost">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function render() {
  const services = activeServices();
  const summary = summarize(services);
  const overall = overallStatus(summary);

  const cards =
    Object.entries(services)
      .map(([id, data]) => serviceCard(id, data))
      .join('') || `<div class="empty">Esperando respuesta de /api/status.</div>`;

  root.innerHTML = `
    <main class="app">
      ${topbar(summary, services)}
      ${overview(summary, overall)}
      ${state.detailForbidden ? `<div class="banner banner--warn">Tu rol no tiene acceso al detalle operativo. Mostrando la vista pública.</div>` : ''}
      ${state.error ? `<div class="banner banner--error">${esc(state.error)}</div>` : ''}
      <div class="section-head">
        <div class="section-head__title">${isAuthed() ? 'Servicios monitoreados · detalle en vivo' : 'Servicios monitoreados'}</div>
        <div class="legend">${legendItem('online')}${legendItem('degraded')}${legendItem('offline')}</div>
      </div>
      <section class="grid">${cards}</section>
      ${isAuthed() ? contextSection() : ''}
      ${!state.token ? loginHint() : ''}
    </main>
    ${loginModal()}
  `;
  createIcons({ icons });
  wireEvents();
}

// ---------- eventos ----------

function wireEvents() {
  document.getElementById('refreshBtn')?.addEventListener('click', () => poll(true));
  document.getElementById('logoutBtn')?.addEventListener('click', () => logout());
  const open = () => {
    state.loginOpen = true;
    state.loginStep = 'password';
    state.loginError = '';
    render();
    document.querySelector('#loginForm input')?.focus();
  };
  document.getElementById('loginToggle')?.addEventListener('click', open);
  document.getElementById('loginToggle2')?.addEventListener('click', open);
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
      body = {
        email: state.loginEmail,
        otp_code: form.otp.value.trim(),
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
      document.querySelector('#loginForm input')?.focus();
      return;
    }

    if (!res.ok || !data.token) {
      state.loginError = data.error || 'No se pudo iniciar sesión.';
      state.loginBusy = false;
      render();
      return;
    }

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
  if (!state.loginOpen) render();
}, 1000);
setInterval(() => poll(false), POLL_MS);
render();
poll(false);
