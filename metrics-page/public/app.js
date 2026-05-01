const state = {
  endpoints: [],
  variables: [],
};

const els = {
  apiStatus: document.getElementById("apiStatus"),
  domainInput: document.getElementById("domainInput"),
  serialInput: document.getElementById("serialInput"),
  keysInput: document.getElementById("keysInput"),
  refreshButton: document.getElementById("refreshButton"),
  requestsTotal: document.getElementById("requestsTotal"),
  bytesTotal: document.getElementById("bytesTotal"),
  endpointCount: document.getElementById("endpointCount"),
  variableCount: document.getElementById("variableCount"),
  endpointSubtitle: document.getElementById("endpointSubtitle"),
  variableSubtitle: document.getElementById("variableSubtitle"),
  endpointRows: document.getElementById("endpointRows"),
  variableRows: document.getElementById("variableRows"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-CL").format(Number(value) || 0);
}

function formatKb(bytes) {
  const kb = (Number(bytes) || 0) / 1024;
  return `${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kb)} KB`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function setStatus(kind, text) {
  els.apiStatus.className = `status-chip ${kind}`;
  els.apiStatus.querySelector("span:last-child").textContent = text;
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return query.toString();
}

async function fetchJson(path) {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function renderSummary() {
  const endpointRequests = state.endpoints.reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  const endpointBytes = state.endpoints.reduce((sum, row) => sum + Number(row.bytes_sent || 0), 0);

  els.requestsTotal.textContent = formatNumber(endpointRequests);
  els.bytesTotal.textContent = formatKb(endpointBytes);
  els.endpointCount.textContent = formatNumber(state.endpoints.length);
  els.variableCount.textContent = formatNumber(state.variables.length);
}

function renderEndpoints() {
  els.endpointSubtitle.textContent = state.endpoints.length
    ? `${formatNumber(state.endpoints.length)} registros encontrados.`
    : "Sin datos para los filtros actuales.";

  if (!state.endpoints.length) {
    els.endpointRows.innerHTML = '<tr><td colspan="6" class="empty">No hay metricas de endpoints.</td></tr>';
    return;
  }

  els.endpointRows.innerHTML = state.endpoints.map((row) => `
    <tr>
      <td class="mono">${escapeHtml(row.endpoint || "-")}</td>
      <td>${escapeHtml(row.domain_slug || "-")}</td>
      <td>${escapeHtml(row.serial_id || "-")}</td>
      <td>${formatNumber(row.request_count)}</td>
      <td>${formatKb(row.bytes_sent)}</td>
      <td>${formatDate(row.updated_at)}</td>
    </tr>
  `).join("");
}

function renderVariables() {
  els.variableSubtitle.textContent = state.variables.length
    ? `${formatNumber(state.variables.length)} variables encontradas.`
    : "Sin variables para los filtros actuales.";

  if (!state.variables.length) {
    els.variableRows.innerHTML = '<tr><td colspan="6" class="empty">No hay metricas por variable.</td></tr>';
    return;
  }

  els.variableRows.innerHTML = state.variables.map((row) => `
    <tr>
      <td class="mono">${escapeHtml(row.nombre_dato || "-")}</td>
      <td>${escapeHtml(row.serial_id || "-")}</td>
      <td>${formatNumber(row.request_count)}</td>
      <td>${formatKb(row.bytes_sent)}</td>
      <td>${formatNumber(row.avg_duration_ms)}</td>
      <td>${formatDate(row.updated_at)}</td>
    </tr>
  `).join("");
}

function renderError(message) {
  const cleanMessage = escapeHtml(message || "No se pudo cargar la informacion.");
  els.endpointRows.innerHTML = `<tr><td colspan="6" class="empty error-row">${cleanMessage}</td></tr>`;
  els.variableRows.innerHTML = `<tr><td colspan="6" class="empty error-row">${cleanMessage}</td></tr>`;
}

async function loadMetrics() {
  const domain = els.domainInput.value.trim();
  const serialId = els.serialInput.value.trim();
  const keys = els.keysInput.value.trim();

  setStatus("", "Actualizando");
  els.refreshButton.disabled = true;

  try {
    const endpointQuery = buildQuery({ domain, serial_id: serialId });
    const variableQuery = buildQuery({ keys, serial_id: serialId });
    const [endpointResult, variableResult] = await Promise.all([
      fetchJson(`/api/metrics${endpointQuery ? `?${endpointQuery}` : ""}`),
      fetchJson(`/api/metrics/by-variable${variableQuery ? `?${variableQuery}` : ""}`),
    ]);

    state.endpoints = Array.isArray(endpointResult.data) ? endpointResult.data : [];
    state.variables = Array.isArray(variableResult.data) ? variableResult.data : [];

    renderSummary();
    renderEndpoints();
    renderVariables();
    setStatus("ok", "API activa");
  } catch (error) {
    state.endpoints = [];
    state.variables = [];
    renderSummary();
    renderError("No se pudo conectar con main-api.");
    setStatus("bad", "API sin respuesta");
  } finally {
    els.refreshButton.disabled = false;
  }
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  els.domainInput.value = params.get("domain") || "";
  els.serialInput.value = params.get("serial_id") || "";
  els.keysInput.value = params.get("keys") || "";
}

els.refreshButton.addEventListener("click", loadMetrics);
[els.domainInput, els.serialInput, els.keysInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadMetrics();
  });
});

hydrateFromUrl();
loadMetrics();
setInterval(loadMetrics, 30000);
