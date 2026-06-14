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

module.exports = { summarize, overallStatus, publicView, detailView, DETAIL_FIELDS };
