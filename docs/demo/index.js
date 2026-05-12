/**
 * Frontend demo sin framework.
 * Controla la pantalla principal, consulta la API y pinta tablas y metricas.
 */
const output = document.getElementById('output');
const serialDisplay = document.getElementById('serialDisplay');
const apiBaseInput = document.getElementById('apiBase');
const referenceDateInput = document.getElementById('referenceDate');
const keySelect = document.getElementById('keySelect');
const statusBadge = document.getElementById('statusBadge');
const heroStatus = document.getElementById('heroStatus');
const heroSerial = document.getElementById('heroSerial');
const heroReference = document.getElementById('heroReference');
const activeMode = document.getElementById('activeMode');
const activeKeys = document.getElementById('activeKeys');
const lastPayloadBytes = document.getElementById('lastPayloadBytes');
const lastDuration = document.getElementById('lastDuration');
const resultsTitle = document.getElementById('resultsTitle');
const resultsSubtitle = document.getElementById('resultsSubtitle');
const resultsTableBody = document.getElementById('resultsTableBody');
const metricsTitle = document.getElementById('metricsTitle');
const metricsSubtitle = document.getElementById('metricsSubtitle');
const metricsBytesTotal = document.getElementById('metricsBytesTotal');
const metricsDurationTotal = document.getElementById('metricsDurationTotal');
const metricsTableBody = document.getElementById('metricsTableBody');
const queryForm = document.getElementById('queryForm');
const presetGroup = document.getElementById('presetGroup');

const state = {
  currentSerial: '',
  keys: [],
  activePreset: '24h',
  viewMode: 'preset',
  tableRows: [],
  variableMetrics: [],
  lastResponse: null,
  lastPayloadBytes: 0,
  lastDurationMs: 0,
};

// Actualiza el estado visual general de la pantalla.
function setStatus(type, text) {
  statusBadge.className = `status-badge status-${type}`;
  statusBadge.textContent = text;
  heroStatus.textContent = text;
}

// Construye query strings evitando parametros vacios.
function buildQuery(paramsObj) {
  const params = new URLSearchParams();

  Object.entries(paramsObj).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      params.set(key, value);
    }
  });

  return params.toString();
}

// Si el HTML se abre sin backend embebido, apunta al puerto 3000 local.
function getDefaultApiBase() {
  if (window.location.protocol === 'file:') {
    return 'http://localhost:3000';
  }

  if (window.location.port === '3000') {
    return window.location.origin;
  }

  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

// Devuelve la URL base real de la API configurada en la pantalla.
function getApiBase() {
  const rawValue = apiBaseInput.value.trim();
  return rawValue.replace(/\/+$/, '') || getDefaultApiBase();
}

// Une la base configurada con una ruta relativa.
function buildApiUrl(path) {
  return `${getApiBase()}${path}`;
}

// Devuelve el serial resuelto actualmente por la UI.
function getSerial() {
  return state.currentSerial;
}

// Sincroniza el serial activo en estado y en la cabecera visual.
function setCurrentSerial(serial) {
  state.currentSerial = String(serial || '').trim();
  const label = state.currentSerial || 'Sin registros';
  serialDisplay.textContent = label;
  heroSerial.textContent = label;
}

// Devuelve las variables elegidas en el selector multiple.
function getSelectedKeys() {
  return Array.from(keySelect.selectedOptions)
    .map((option) => option.value.trim())
    .filter(Boolean);
}

// Genera un texto resumido con las variables activas.
function getSelectedKeysLabel() {
  const selectedKeys = getSelectedKeys();

  if (!selectedKeys.length) return 'Todas';
  if (selectedKeys.length <= 3) return selectedKeys.join(', ');
  return `${selectedKeys.length} variables`;
}

// Asegura dos digitos para fechas y horas.
function pad(value) {
  return String(value).padStart(2, '0');
}

// Convierte una fecha JS al formato que espera un input datetime-local.
function formatDateTimeLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Convierte una fecha JS al formato literal esperado por la API.
function formatDateTimeForApi(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Muestra una fecha en formato humano para la interfaz.
function formatHumanDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Sin datos';
  }

  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// Interpreta fecha y hora separadas que vienen desde la API.
function parseApiDate(dateText, timeText = '00:00:00') {
  if (!dateText) return null;
  const parsed = new Date(`${dateText}T${timeText}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Guarda la fecha de referencia actual tanto en el input como en la cabecera.
function setReferenceDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return;
  }

  referenceDateInput.value = formatDateTimeLocalInput(date);
  heroReference.textContent = formatHumanDate(date);
}

// Toma un timestamp textual y lo refleja como fecha de referencia actual.
function setReferenceDateFromLiteral(timestamp) {
  if (!timestamp) return;

  const [dateText, timeText = '00:00:00'] = String(timestamp).split(' ');
  setReferenceDateValue(parseApiDate(dateText, timeText));
}

// Formatea bytes para mostrarlos en B o KB.
function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value < 1024) {
    return `${value} B`;
  }

  return `${(value / 1024).toFixed(2)} KB`;
}

// Mantiene un formato visual consistente para KB en la tabla de metricas.
function formatMetricKb(kbValue) {
  return `${Number(kbValue || 0).toFixed(2)}`;
}

// Serializa cualquier valor para mostrarlo en el panel tecnico.
function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

// Escapa texto antes de insertarlo en HTML generado por template strings.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convierte valores de la respuesta a texto amigable para celdas de tabla.
function formatCellValue(value) {
  if (value === null || value === undefined) {
    return 'Sin valor';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

// Aplana filas historicas para pintarlas como una fila por variable.
function flattenHistoryRows(rows) {
  return rows.flatMap((row) => {
    const entries = Object.entries(row?.data || {});

    return entries.map(([variable, value]) => ({
      equipo: row.id_serial,
      fecha: row.fecha,
      hora: row.hora,
      variable,
      valor: value,
    }));
  });
}

// Aplana la vista online para reutilizar la tabla principal.
function flattenOnlineRows(rows) {
  return rows.map((row) => ({
    equipo: row.id_serial,
    fecha: row.fecha,
    hora: row.hora,
    variable: row.nombre_dato,
    valor: row.valor_dato,
  }));
}

// Refresca tarjetas de resumen con el estado actual de la ultima consulta.
function updateSummaryCards() {
  heroSerial.textContent = getSerial() || 'Sin registros';
  activeMode.textContent =
    state.viewMode === 'online' ? 'Vista online' : `Historico ${state.activePreset}`;
  activeKeys.textContent = getSelectedKeysLabel();
  lastPayloadBytes.textContent = formatBytes(state.lastPayloadBytes);
  lastDuration.textContent = `${state.lastDurationMs} ms`;
}

// Marca visualmente el preset o modo actualmente activo.
function renderPresetButtons() {
  Array.from(presetGroup.querySelectorAll('.preset-chip')).forEach((button) => {
    const isOnlineButton = button.dataset.mode === 'online';
    const isActive = isOnlineButton
      ? state.viewMode === 'online'
      : state.viewMode === 'preset' && button.dataset.preset === state.activePreset;

    button.classList.toggle('is-active', isActive);
  });
}

// Pinta la tabla principal de resultados.
function renderResultsTable() {
  const rows = state.tableRows;

  resultsTitle.textContent =
    state.viewMode === 'online'
      ? 'Vista online completada'
      : `Consulta ${state.activePreset} completada`;
  resultsSubtitle.textContent = `${rows.length} registro(s) devueltos para ${getSelectedKeysLabel()} en el equipo ${getSerial() || 'sin serial'}.`;

  if (!rows.length) {
    resultsTableBody.innerHTML =
      '<tr><td colspan="5" class="empty-cell">No hay resultados para los filtros seleccionados.</td></tr>';
    return;
  }

  resultsTableBody.innerHTML = rows
    .slice(0, 500)
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.equipo)}</td>
        <td>${escapeHtml(row.fecha)}</td>
        <td>${escapeHtml(row.hora)}</td>
        <td><span class="variable-pill">${escapeHtml(row.variable)}</span></td>
        <td class="value-cell">${escapeHtml(formatCellValue(row.valor))}</td>
      </tr>
    `,
    )
    .join('');
}

// Pinta la tabla lateral con metricas acumuladas por variable.
function renderMetricsTable() {
  const rows = state.variableMetrics;
  const totalBytesKb = rows.reduce((acc, row) => acc + (Number(row.bytes_sent_kb) || 0), 0);
  const totalDurationMs = rows.reduce((acc, row) => acc + (Number(row.duration_ms_total) || 0), 0);

  metricsTitle.textContent = `Metricas cargadas · ${rows.length} variable(s)`;
  metricsSubtitle.textContent = rows.length
    ? `Consumo acumulado por nombre_dato para el equipo ${getSerial() || 'sin serial'}.`
    : 'Sin metricas acumuladas todavia para esta seleccion.';
  metricsBytesTotal.textContent = `${totalBytesKb.toFixed(2)} KB`;
  metricsDurationTotal.textContent = `${totalDurationMs} ms`;

  if (!rows.length) {
    metricsTableBody.innerHTML =
      '<tr><td colspan="4" class="empty-cell">Todavia no se cargan metricas por variable.</td></tr>';
    return;
  }

  metricsTableBody.innerHTML = rows
    .slice(0, 50)
    .map(
      (row) => `
      <tr>
        <td><span class="variable-pill">${escapeHtml(row.nombre_dato)}</span></td>
        <td>${escapeHtml(String(row.request_count || 0))}</td>
        <td>${escapeHtml(formatMetricKb(row.bytes_sent_kb))}</td>
        <td>${escapeHtml(String(row.duration_ms_total || 0))}</td>
      </tr>
    `,
    )
    .join('');
}

// Vuelve a dibujar todas las secciones dependientes del estado local.
function refreshUi() {
  updateSummaryCards();
  renderPresetButtons();
  renderResultsTable();
  renderMetricsTable();
}

// Guarda las metricas de tamano y duracion de la ultima respuesta principal.
function updateRequestStats(result) {
  state.lastPayloadBytes = Number(result?.payload_bytes) || 0;
  state.lastDurationMs = Number(result?.response_time_ms) || 0;
}

// Ejecuta un fetch JSON con manejo comun de errores y panel tecnico.
async function fetchJson(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    headers: { Accept: 'application/json' },
  });
  const raw = await response.text();

  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(raw || `Respuesta no valida desde ${path}`);
  }

  if (options.updateDebug !== false) {
    state.lastResponse = data;
    output.textContent = safeJson(data);
  }

  if (!response.ok) {
    throw new Error(data.message || `Error ${response.status}`);
  }

  return data;
}

// Toma el serial resuelto por la respuesta y lo sincroniza con la UI.
function syncResolvedSerial(result) {
  const resolvedSerial = result?.filters?.serial_id || result?.data?.[0]?.id_serial || '';
  if (resolvedSerial) {
    setCurrentSerial(resolvedSerial);
  }
}

// Garantiza que exista un equipo activo antes de lanzar nuevas consultas.
async function ensureActiveSerial() {
  if (getSerial()) {
    return getSerial();
  }

  const result = await fetchJson('/api/data/latest', { updateDebug: false });
  syncResolvedSerial(result);

  const latestRow = result?.data?.[0];
  if (latestRow?.fecha && latestRow?.hora) {
    setReferenceDateValue(parseApiDate(latestRow.fecha, latestRow.hora));
  }

  return getSerial();
}

// Carga la lista de variables disponibles para el equipo activo.
async function loadKeys({ preserveSelection = [] } = {}) {
  const serial = await ensureActiveSerial();
  if (!serial) {
    state.keys = [];
    keySelect.innerHTML = '';
    return;
  }

  const result = await fetchJson(`/api/data/keys?${buildQuery({ serial_id: serial })}`, {
    updateDebug: false,
  });
  syncResolvedSerial(result);

  state.keys = Array.isArray(result.data) ? result.data : [];
  keySelect.innerHTML = '';

  state.keys.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    option.selected = preserveSelection.includes(key);
    keySelect.appendChild(option);
  });
}

// Consulta el ultimo registro solo para resolver la fecha de referencia.
async function loadLatestReference() {
  const serial = await ensureActiveSerial();
  if (!serial) {
    return null;
  }

  const result = await fetchJson(`/api/data/latest?${buildQuery({ serial_id: serial })}`, {
    updateDebug: false,
  });
  syncResolvedSerial(result);

  const latestRow = result?.data?.[0];
  if (latestRow?.fecha && latestRow?.hora) {
    setReferenceDateValue(parseApiDate(latestRow.fecha, latestRow.hora));
  }

  return result;
}

// Carga las metricas acumuladas por nombre_dato.
async function loadVariableMetrics() {
  const serial = await ensureActiveSerial();
  if (!serial) {
    state.variableMetrics = [];
    return;
  }

  const result = await fetchJson(
    `/api/metrics/by-variable?${buildQuery({
      serial_id: serial,
      keys: getSelectedKeys().join(','),
    })}`,
    { updateDebug: false },
  );
  syncResolvedSerial(result);

  state.variableMetrics = Array.isArray(result.data) ? result.data : [];
}

// Ejecuta la vista historica basada en el preset activo.
async function loadHistoricalView() {
  const serial = await ensureActiveSerial();
  if (!serial) {
    state.viewMode = 'preset';
    state.tableRows = [];
    state.variableMetrics = [];
    state.lastPayloadBytes = 0;
    state.lastDurationMs = 0;
    refreshUi();
    return;
  }

  if (!referenceDateInput.value) {
    await loadLatestReference();
  }

  const result = await fetchJson(
    `/api/data/preset?${buildQuery({
      serial_id: serial,
      keys: getSelectedKeys().join(','),
      preset: state.activePreset,
      base_date: referenceDateInput.value
        ? formatDateTimeForApi(new Date(referenceDateInput.value))
        : '',
    })}`,
  );
  syncResolvedSerial(result);

  if (result?.filters?.base_date) {
    setReferenceDateFromLiteral(result.filters.base_date);
  }

  state.viewMode = 'preset';
  state.tableRows = flattenHistoryRows(result.data || []);
  updateRequestStats(result);
  await loadVariableMetrics();
  refreshUi();
}

// Ejecuta la vista online con el ultimo valor por variable.
async function loadOnlineView() {
  const serial = await ensureActiveSerial();
  if (!serial) {
    state.viewMode = 'online';
    state.tableRows = [];
    state.variableMetrics = [];
    state.lastPayloadBytes = 0;
    state.lastDurationMs = 0;
    refreshUi();
    return;
  }

  const result = await fetchJson(
    `/api/data/online?${buildQuery({
      serial_id: serial,
      keys: getSelectedKeys().join(','),
    })}`,
  );
  syncResolvedSerial(result);

  const firstRow = result?.data?.[0];
  if (firstRow?.fecha && firstRow?.hora) {
    setReferenceDateValue(parseApiDate(firstRow.fecha, firstRow.hora));
  }

  state.viewMode = 'online';
  state.tableRows = flattenOnlineRows(result.data || []);
  updateRequestStats(result);
  await loadVariableMetrics();
  refreshUi();
}

// Recarga toda la pantalla respetando el modo activo.
async function loadAll() {
  const preservedKeys = getSelectedKeys();
  await ensureActiveSerial();
  await loadKeys({ preserveSelection: preservedKeys });
  await loadLatestReference();

  if (state.viewMode === 'online') {
    await loadOnlineView();
    return;
  }

  await loadHistoricalView();
}

// Wrapper comun para mostrar estado de carga, exito o error por accion.
async function runAction(label, callback) {
  try {
    setStatus('loading', `${label} en curso`);
    await callback();
    setStatus('ok', `${label} completada`);
  } catch (error) {
    setStatus('error', error.message);
    output.textContent = error.message;
    throw error;
  }
}

// Boton para historico basado en preset.
document.getElementById('loadPresetButton').addEventListener('click', () => {
  runAction(`Consulta ${state.activePreset}`, loadHistoricalView).catch(() => {});
});

// Boton para vista online.
document.getElementById('loadOnlineButton').addEventListener('click', () => {
  runAction('Vista online', loadOnlineView).catch(() => {});
});

// Boton para refrescar todo el dashboard.
document.getElementById('loadAllButton').addEventListener('click', () => {
  runAction('Actualizacion completa', loadAll).catch(() => {});
});

// Boton para volver a consultar solo el catalogo de variables.
document.getElementById('loadKeysButton').addEventListener('click', () => {
  runAction('Carga de variables', async () => {
    await loadKeys({ preserveSelection: getSelectedKeys() });
    await loadVariableMetrics();
    refreshUi();
  }).catch(() => {});
});

// Cambia entre presets y modo online desde la barra superior.
presetGroup.addEventListener('click', (event) => {
  const target = event.target.closest('.preset-chip');
  if (!target) return;

  if (target.dataset.mode === 'online') {
    runAction('Vista online', loadOnlineView).catch(() => {});
    return;
  }

  state.activePreset = target.dataset.preset;
  state.viewMode = 'preset';
  refreshUi();
  runAction(`Consulta ${state.activePreset}`, loadHistoricalView).catch(() => {});
});

// Si cambian las variables, se vuelve a consultar la vista activa.
keySelect.addEventListener('change', () => {
  const action = state.viewMode === 'online' ? loadOnlineView : loadHistoricalView;
  const label = state.viewMode === 'online' ? 'Vista online' : `Consulta ${state.activePreset}`;
  runAction(label, action).catch(() => {});
});

// Evita submit real y reutiliza la accion del modo activo.
queryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const action = state.viewMode === 'online' ? loadOnlineView : loadHistoricalView;
  const label = state.viewMode === 'online' ? 'Vista online' : `Consulta ${state.activePreset}`;
  runAction(label, action).catch(() => {});
});

// Arranque inicial de la demo al cargar el navegador.
(async function init() {
  apiBaseInput.value = getDefaultApiBase();
  setCurrentSerial('');
  refreshUi();

  await runAction('Carga inicial', async () => {
    await ensureActiveSerial();
    await loadKeys();
    await loadLatestReference();
    await loadHistoricalView();
  });
})().catch((error) => {
  setStatus('error', error.message);
  output.textContent = error.message;
});
