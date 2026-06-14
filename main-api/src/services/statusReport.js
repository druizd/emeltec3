/**
 * Lógica pura de reporte de estado de servicios.
 *
 * Separa el "qué se muestra" del "cómo se sondea" (I/O en statusController):
 *  - publicView: vista PÚBLICA mínima (`/api/status`) — solo el estado, sin
 *    filtrar detalle interno (EMT-C03/M08).
 *  - detailView: vista AUTENTICADA (`/api/status/detail`, SuperAdmin/Admin) —
 *    lista blanca de campos de detalle; nunca campos arbitrarios.
 */

const VALID_STATUSES = ['online', 'degraded', 'offline'];

// Campos de detalle permitidos en la vista autenticada. Cualquier otro
// (hosts internos, stacks, etc.) se descarta aunque el sondeo lo produzca.
const DETAIL_FIELDS = [
  'status',
  'response_time_ms',
  'uptime_s',
  'environment',
  'version',
  'node_version',
  'http_status',
  'error',
];

function normalizeStatus(status) {
  return VALID_STATUSES.includes(status) ? status : 'offline';
}

function summarize(services) {
  const values = Object.values(services || {});
  return {
    total: values.length,
    online: values.filter((s) => s.status === 'online').length,
    degraded: values.filter((s) => s.status === 'degraded').length,
    offline: values.filter((s) => s.status === 'offline').length,
  };
}

function overallStatus(services) {
  const values = Object.values(services || {});
  if (values.length === 0) return 'degraded';
  if (values.some((s) => s.status === 'offline')) return 'offline';
  if (values.some((s) => s.status === 'degraded')) return 'degraded';
  return 'online';
}

function publicView(service) {
  return { status: normalizeStatus(service && service.status) };
}

function detailView(service) {
  const view = {};
  for (const field of DETAIL_FIELDS) {
    const value = service ? service[field] : undefined;
    if (value !== null && value !== undefined) {
      view[field] = field === 'status' ? normalizeStatus(value) : value;
    }
  }
  if (view.status === undefined) view.status = 'offline';
  return view;
}

/**
 * Frescura de ingesta: clasifica cada sitio activo según hace cuánto recibió su
 * última medición. `rows` viene del query (cada uno con `last_received_at`).
 * - online: todos transmitiendo dentro del umbral.
 * - degraded: algunos al día, otros stale.
 * - offline: ninguno transmitiendo.
 * - unknown: no hay sitios activos que evaluar.
 */
function ingestionSummary(rows, nowMs, freshMs) {
  const sites = rows || [];
  let transmitting = 0;
  let stale = 0;
  let newest = null;
  for (const r of sites) {
    const t = r && r.last_received_at ? new Date(r.last_received_at).getTime() : null;
    if (t == null || Number.isNaN(t)) {
      stale += 1;
      continue;
    }
    if (newest == null || t > newest) newest = t;
    if (nowMs - t <= freshMs) transmitting += 1;
    else stale += 1;
  }
  const status =
    sites.length === 0
      ? 'unknown'
      : stale === 0
        ? 'online'
        : transmitting === 0
          ? 'offline'
          : 'degraded';
  return {
    status,
    sites_total: sites.length,
    transmitting,
    stale,
    last_age_s: newest == null ? null : Math.max(0, Math.round((nowMs - newest) / 1000)),
  };
}

/**
 * Estado de los workers in-process a partir de sus latidos (`beats[name] = ms`).
 * Un worker sin latido es `unknown`; con latido más viejo que `staleMs`,
 * `degraded` (posiblemente colgado); si no, `online`.
 */
function workerSnapshot(beats, names, nowMs, staleMs) {
  return (names || []).map((name) => {
    const last = beats ? beats[name] : undefined;
    if (last == null) return { name, status: 'unknown', last_run_s: null };
    const age = Math.max(0, Math.round((nowMs - last) / 1000));
    return { name, status: nowMs - last <= staleMs ? 'online' : 'degraded', last_run_s: age };
  });
}

/** Da forma a process.memoryUsage() en MB redondeados para el panel. */
function processVitals(mem) {
  const mb = (n) => (n == null ? null : Math.round(n / 1048576));
  return {
    heap_mb: mb(mem && mem.heapUsed),
    rss_mb: mb(mem && mem.rss),
  };
}

module.exports = {
  summarize,
  overallStatus,
  publicView,
  detailView,
  ingestionSummary,
  workerSnapshot,
  processVitals,
  DETAIL_FIELDS,
};
