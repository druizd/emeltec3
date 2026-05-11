/**
 * Servidor gRPC principal.
 * Expone una capa paralela a la API HTTP para consultar salud, datos y metricas.
 */
const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const pool = require("../config/db");
const { getLatestSerialId } = require("../utils/serial");
const { CHILE_TIME_ZONE, formatChileTimestamp, parseChileTimestamp } = require("../utils/timezone");
const {
  trackRequest,
  getRequestMetrics,
  registerVariableMetrics,
  getVariableMetrics,
} = require("../services/metricsService");

const PROTO_PATH = path.join(__dirname, "mainApi.proto");

// Equivalencias aceptadas para los presets temporales en gRPC.
const PRESET_ALIASES = {
  "24h": { amount: 24, unit: "hours", canonical: "24h" },
  "7d": { amount: 7, unit: "days", canonical: "7d" },
  "30d": { amount: 30, unit: "days", canonical: "30d" },
  "365d": { amount: 365, unit: "days", canonical: "365d" },
  "1y": { amount: 365, unit: "days", canonical: "365d" },
  "1a": { amount: 365, unit: "days", canonical: "365d" },
  "1year": { amount: 365, unit: "days", canonical: "365d" },
};

// Carga el archivo .proto y devuelve el paquete tipado que usa grpc-js.
function loadProto() {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  return grpc.loadPackageDefinition(packageDefinition).mainapi;
}

// Calcula el peso en bytes de la respuesta serializada para registrar metricas.
function payloadBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

// Convierte el tiempo transcurrido desde process.hrtime a milisegundos enteros.
function elapsedMilliseconds(startedAt) {
  const elapsedNs = process.hrtime.bigint() - startedAt;
  return Math.max(0, Math.round(Number(elapsedNs) / 1e6));
}

// Normaliza el preset recibido a una configuracion valida o null.
function normalizePreset(rawPreset) {
  return PRESET_ALIASES[String(rawPreset || "").trim().toLowerCase()] || null;
}

// Acepta un arreglo de keys desde gRPC y lo limpia para usarlo en consultas SQL.
function parseSelectedKeys(rawKeys) {
  if (!Array.isArray(rawKeys)) {
    return [];
  }

  return [...new Set(
    rawKeys
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

// Limita un entero positivo para consultas donde siempre debe existir limite.
function parseLimit(limit, fallback = 100) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 5000);
}

// Devuelve null si no se envió un límite útil; sirve para endpoints opcionales.
function parseOptionalLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, 5000);
}

// Proyecta solo las variables seleccionadas sobre un objeto JSONB completo.
function projectDataByKeys(data, selectedKeys) {
  if (!selectedKeys.length) {
    return data || {};
  }

  const projected = {};

  for (const key of selectedKeys) {
    if (Object.prototype.hasOwnProperty.call(data || {}, key)) {
      projected[key] = data[key];
    }
  }

  return projected;
}

// Adapta una fila historica de PostgreSQL al formato interno reutilizable.
function mapHistoryRow(row, selectedKeys) {
  const projectedData = projectDataByKeys(row.data, selectedKeys);

  return {
    id_serial: row.id_serial,
    fecha: row.fecha,
    hora: row.hora,
    data: projectedData,
    timestamp_completo: `${row.fecha} ${row.hora}`,
    selected_keys: selectedKeys,
    keys_present: Object.keys(projectedData),
  };
}

// Genera el fragmento SQL necesario para filtrar por una o varias keys dentro del JSONB.
function buildDataFilterClause(selectedKeys, params) {
  if (selectedKeys.length === 1) {
    params.push(selectedKeys[0]);
    return ` AND data ? $${params.length}`;
  }

  if (selectedKeys.length > 1) {
    params.push(selectedKeys);
    return ` AND data ?| $${params.length}::text[]`;
  }

  return "";
}

function chileDateSql(column) {
  return `TO_CHAR(${column} AT TIME ZONE '${CHILE_TIME_ZONE}', 'YYYY-MM-DD')`;
}

function chileTimeSql(column) {
  return `TO_CHAR(${column} AT TIME ZONE '${CHILE_TIME_ZONE}', 'HH24:MI:SS')`;
}

// Ejecuta la consulta historica base usada por latest y preset.
async function executeHistoryQuery({ serialId, selectedKeys, from, to, limit }) {
  const params = [serialId];
  let where = "WHERE id_serial = $1";

  if (from && to) {
    params.push(from, to);
    where += ` AND time BETWEEN ($2::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}') AND ($3::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')`;
  }

  where += buildDataFilterClause(selectedKeys, params);

  const query = `
    SELECT
      id_serial,
      ${chileDateSql('time')} AS fecha,
      ${chileTimeSql('time')} AS hora,
      data
    FROM equipo
    ${where}
    ORDER BY time DESC
    ${Number.isFinite(limit) ? `LIMIT $${params.length + 1}` : ""}
  `;

  if (Number.isFinite(limit)) {
    params.push(limit);
  }

  const { rows } = await pool.query(query, params);
  return rows.map((row) => mapHistoryRow(row, selectedKeys));
}

// Busca el ultimo timestamp disponible para un equipo.
async function getLatestReferenceTimestamp(serialId) {
  const { rows } = await pool.query(
    `
    SELECT
      ${chileDateSql('time')} AS fecha,
      ${chileTimeSql('time')} AS hora
    FROM equipo
    WHERE id_serial = $1
    ORDER BY time DESC
    LIMIT 1
    `,
    [serialId]
  );

  if (!rows.length) {
    return null;
  }

  return `${rows[0].fecha} ${rows[0].hora}`;
}

// Interpreta fechas literales enviadas por el cliente gRPC.
function parseTimestampLiteral(rawValue) {
  return parseChileTimestamp(rawValue);
}

// Devuelve un timestamp normalizado en el formato que usan las consultas SQL.
function formatTimestampLiteral(date) {
  return formatChileTimestamp(date);
}

// Construye el rango from/to a partir de un preset y una fecha final.
function buildRangeFromPreset(presetConfig, endDate) {
  const startDate = new Date(endDate);

  if (presetConfig.unit === "hours") {
    startDate.setUTCHours(startDate.getUTCHours() - presetConfig.amount);
  } else {
    startDate.setUTCDate(startDate.getUTCDate() - presetConfig.amount);
  }

  return {
    from: formatTimestampLiteral(startDate),
    to: formatTimestampLiteral(endDate),
  };
}

// Si no se indico serial, usa el equipo mas reciente disponible en la tabla equipo.
async function resolveSerialId(candidateSerialId) {
  if (candidateSerialId) {
    return String(candidateSerialId).trim();
  }

  return getLatestSerialId(pool);
}

// Serializa valores JSONB para enviarlos como texto estable en gRPC.
function serializeValue(value) {
  return JSON.stringify(value);
}

// Convierte filas historicas internas al formato definido en el .proto.
function toGrpcHistoryRows(rows) {
  return rows.map((row) => ({
    id_serial: row.id_serial,
    fecha: row.fecha,
    hora: row.hora,
    timestamp_completo: row.timestamp_completo,
    selected_keys: row.selected_keys || [],
    keys_present: row.keys_present || [],
    values: Object.entries(row.data || {}).map(([nombre_dato, valor]) => ({
      nombre_dato,
      valor_json: serializeValue(valor),
    })),
  }));
}

// Convierte la vista online al formato definido en el .proto.
function toGrpcOnlineRows(rows) {
  return rows.map((row) => ({
    id_serial: row.id_serial,
    nombre_dato: row.nombre_dato,
    valor_json: serializeValue(row.valor_dato),
    fecha: row.fecha,
    hora: row.hora,
    timestamp_completo: row.timestamp_completo,
  }));
}

// Recolecta todas las keys presentes en un bloque de filas historicas.
function collectHistoryKeys(rows) {
  return [...new Set(rows.flatMap((row) => Object.keys(row?.data || {})))];
}

// Genera metricas por variable a partir de respuestas historicas gRPC.
function buildHistoryVariableMetricEntries(filters, rows, extras, selectedKeys, serialId, durationMs) {
  const keysToTrack = selectedKeys.length ? selectedKeys : collectHistoryKeys(rows);

  if (!keysToTrack.length) {
    return [];
  }

  const durationShare = Math.max(0, Math.round(durationMs / keysToTrack.length));

  return keysToTrack.map((key) => {
    const projectedRows = rows
      .map((row) => {
        const projectedData = projectDataByKeys(row?.data, [key]);
        return Object.keys(projectedData).length
          ? {
              ...row,
              data: projectedData,
              selected_keys: [key],
              keys_present: Object.keys(projectedData),
            }
          : null;
      })
      .filter(Boolean);

    const payload = {
      ok: true,
      serial_id: serialId || "",
      selected_keys: [key],
      count: projectedRows.length,
      data: toGrpcHistoryRows(projectedRows),
      ...extras,
    };

    return {
      nombre_dato: key,
      serial_id: serialId,
      bytes_sent: payloadBytes(payload),
      duration_ms: durationShare,
    };
  });
}

// Genera metricas por variable a partir de la vista online gRPC.
function buildOnlineVariableMetricEntries(selectedKeys, rows, serialId, durationMs) {
  const keysToTrack = selectedKeys.length
    ? selectedKeys
    : [...new Set(rows.map((row) => row.nombre_dato).filter(Boolean))];

  if (!keysToTrack.length) {
    return [];
  }

  const durationShare = Math.max(0, Math.round(durationMs / keysToTrack.length));

  return keysToTrack.map((key) => {
    const projectedRows = rows.filter((row) => row.nombre_dato === key);
    const payload = {
      ok: true,
      serial_id: serialId || "",
      selected_keys: [key],
      count: projectedRows.length,
      data: toGrpcOnlineRows(projectedRows),
    };

    return {
      nombre_dato: key,
      serial_id: serialId,
      bytes_sent: payloadBytes(payload),
      duration_ms: durationShare,
    };
  });
}

// Adapta errores internos al formato de error esperado por grpc-js.
function grpcError(code, message) {
  return { code, message };
}

// Completa bytes y metricas acumuladas antes de devolver respuestas historicas.
async function finalizeHistoryResponse(baseResponse, endpoint, serialId, variableMetrics) {
  const bytes = payloadBytes(baseResponse);

  await trackRequest(endpoint, "grpc", serialId, bytes);
  await registerVariableMetrics(variableMetrics);
  const metrics = await getRequestMetrics(endpoint, "grpc", serialId);

  return {
    ...baseResponse,
    payload_bytes: bytes,
    request_count_total: metrics.request_count_total,
    bytes_sent_total: metrics.bytes_sent_total,
    metrics_updated_at: metrics.updated_at || "",
  };
}

// RPC de salud: verifica que el proceso y la base esten operativos.
async function getHealth(call, callback) {
  try {
    const { rows } = await pool.query("SELECT NOW() AS server_time");
    callback(null, {
      ok: true,
      message: "API principal operativa",
      database: "Conexion exitosa",
      server_time: String(rows[0].server_time),
    });
  } catch (error) {
    callback(grpcError(grpc.status.INTERNAL, error.message));
  }
}

// RPC que devuelve el ultimo registro historico del equipo.
async function getLatest(call, callback) {
  const startedAt = process.hrtime.bigint();

  try {
    const selectedKeys = parseSelectedKeys(call.request.keys);
    const serialId = await resolveSerialId(call.request.serial_id);

    if (!serialId) {
      const response = await finalizeHistoryResponse(
        {
          ok: true,
          message: "No hay registros disponibles todavia.",
          serial_id: "",
          selected_keys: selectedKeys,
          count: 0,
          data: [],
          response_time_ms: elapsedMilliseconds(startedAt),
        },
        "gRPC MainApi/GetLatest",
        null,
        []
      );
      callback(null, response);
      return;
    }

    const rows = await executeHistoryQuery({
      serialId,
      selectedKeys,
      limit: parseLimit(call.request.limit, 1),
    });
    const durationMs = elapsedMilliseconds(startedAt);
    const response = await finalizeHistoryResponse(
      {
        ok: true,
        message: "",
        serial_id: serialId,
        selected_keys: selectedKeys,
        count: rows.length,
        data: toGrpcHistoryRows(rows),
        response_time_ms: durationMs,
      },
      "gRPC MainApi/GetLatest",
      serialId,
      buildHistoryVariableMetricEntries(
        { serial_id: serialId, selected_keys: selectedKeys },
        rows,
        {},
        selectedKeys,
        serialId,
        durationMs
      )
    );

    callback(null, response);
  } catch (error) {
    callback(grpcError(grpc.status.INTERNAL, error.message));
  }
}

// RPC que devuelve el ultimo valor conocido por variable.
async function getOnlineValues(call, callback) {
  const startedAt = process.hrtime.bigint();

  try {
    const serialId = await resolveSerialId(call.request.serial_id);
    const selectedKeys = parseSelectedKeys(call.request.keys);

    if (!serialId) {
      const bytesResponse = {
        ok: true,
        message: "No hay registros disponibles todavia.",
        serial_id: "",
        selected_keys: selectedKeys,
        count: 0,
        data: [],
        response_time_ms: elapsedMilliseconds(startedAt),
      };
      const response = await finalizeHistoryResponse(
        bytesResponse,
        "gRPC MainApi/GetOnlineValues",
        null,
        []
      );
      callback(null, response);
      return;
    }

    const params = [serialId];
    let keyWhere = "";

    if (selectedKeys.length === 1) {
      params.push(selectedKeys[0]);
      keyWhere = ` AND kv.key = $${params.length}`;
    } else if (selectedKeys.length > 1) {
      params.push(selectedKeys);
      keyWhere = ` AND kv.key = ANY($${params.length}::text[])`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        latest.id_serial,
        latest.nombre_dato,
        latest.valor_dato,
        ${chileDateSql('latest.time')} AS fecha,
        ${chileTimeSql('latest.time')} AS hora
      FROM (
        SELECT DISTINCT ON (kv.key)
          lr.id_serial,
          kv.key AS nombre_dato,
          kv.value AS valor_dato,
          lr.time
        FROM equipo lr
        CROSS JOIN LATERAL jsonb_each(lr.data) AS kv(key, value)
        WHERE lr.id_serial = $1
        ${keyWhere}
        ORDER BY kv.key, lr.time DESC
      ) latest
      ORDER BY latest.nombre_dato ASC
      `,
      params
    );

    const mapped = rows.map((row) => ({
      id_serial: row.id_serial,
      nombre_dato: row.nombre_dato,
      valor_dato: row.valor_dato,
      fecha: row.fecha,
      hora: row.hora,
      timestamp_completo: `${row.fecha} ${row.hora}`,
    }));
    const durationMs = elapsedMilliseconds(startedAt);
    const baseResponse = {
      ok: true,
      message: "",
      serial_id: serialId,
      selected_keys: selectedKeys,
      count: mapped.length,
      data: toGrpcOnlineRows(mapped),
      response_time_ms: durationMs,
    };
    const bytes = payloadBytes(baseResponse);

    await trackRequest("gRPC MainApi/GetOnlineValues", "grpc", serialId, bytes);
    await registerVariableMetrics(
      buildOnlineVariableMetricEntries(selectedKeys, mapped, serialId, durationMs)
    );
    const metrics = await getRequestMetrics("gRPC MainApi/GetOnlineValues", "grpc", serialId);

    callback(null, {
      ...baseResponse,
      payload_bytes: bytes,
      request_count_total: metrics.request_count_total,
      bytes_sent_total: metrics.bytes_sent_total,
      metrics_updated_at: metrics.updated_at || "",
    });
  } catch (error) {
    callback(grpcError(grpc.status.INTERNAL, error.message));
  }
}

// RPC que resuelve un rango desde un preset temporal.
async function getPreset(call, callback) {
  const startedAt = process.hrtime.bigint();

  try {
    const serialId = await resolveSerialId(call.request.serial_id);
    const selectedKeys = parseSelectedKeys(call.request.keys);
    const presetConfig = normalizePreset(call.request.preset);

    if (!call.request.preset) {
      callback(grpcError(grpc.status.INVALID_ARGUMENT, "preset es obligatorio"));
      return;
    }

    if (!presetConfig) {
      callback(grpcError(grpc.status.INVALID_ARGUMENT, "Preset invalido. Usa 24h, 7d, 30d o 365d"));
      return;
    }

    if (!serialId) {
      const response = await finalizeHistoryResponse(
        {
          ok: true,
          message: "No hay registros disponibles todavia.",
          serial_id: "",
          selected_keys: selectedKeys,
          count: 0,
          data: [],
          response_time_ms: elapsedMilliseconds(startedAt),
          preset: presetConfig.canonical,
          base_date: "",
          from: "",
          to: "",
        },
        "gRPC MainApi/GetPreset",
        null,
        []
      );
      callback(null, response);
      return;
    }

    const resolvedBaseDate =
      call.request.base_date || (await getLatestReferenceTimestamp(serialId));

    if (!resolvedBaseDate) {
      const response = await finalizeHistoryResponse(
        {
          ok: true,
          message: "No hay registros para ese serial.",
          serial_id: serialId,
          selected_keys: selectedKeys,
          count: 0,
          data: [],
          response_time_ms: elapsedMilliseconds(startedAt),
          preset: presetConfig.canonical,
          base_date: "",
          from: "",
          to: "",
        },
        "gRPC MainApi/GetPreset",
        serialId,
        []
      );
      callback(null, response);
      return;
    }

    const endDate = parseTimestampLiteral(resolvedBaseDate);

    if (!endDate) {
      callback(grpcError(grpc.status.INVALID_ARGUMENT, "base_date no tiene un formato valido"));
      return;
    }

    const { from, to } = buildRangeFromPreset(presetConfig, endDate);
    const rows = await executeHistoryQuery({
      serialId,
      selectedKeys,
      from,
      to,
      limit: parseOptionalLimit(call.request.limit),
    });
    const durationMs = elapsedMilliseconds(startedAt);
    const response = await finalizeHistoryResponse(
      {
        ok: true,
        message: "",
        serial_id: serialId,
        selected_keys: selectedKeys,
        count: rows.length,
        data: toGrpcHistoryRows(rows),
        response_time_ms: durationMs,
        preset: presetConfig.canonical,
        base_date: formatTimestampLiteral(endDate),
        from,
        to,
      },
      "gRPC MainApi/GetPreset",
      serialId,
      buildHistoryVariableMetricEntries(
        { serial_id: serialId, selected_keys: selectedKeys },
        rows,
        {},
        selectedKeys,
        serialId,
        durationMs
      )
    );

    callback(null, response);
  } catch (error) {
    callback(grpcError(grpc.status.INTERNAL, error.message));
  }
}

// RPC que lista las variables detectadas para el equipo activo.
async function getAvailableKeys(call, callback) {
  const startedAt = process.hrtime.bigint();

  try {
    const serialId = await resolveSerialId(call.request.serial_id);

    if (!serialId) {
      const baseResponse = {
        ok: true,
        message: "No hay registros disponibles todavia.",
        serial_id: "",
        count: 0,
        data: [],
        response_time_ms: elapsedMilliseconds(startedAt),
      };
      const bytes = payloadBytes(baseResponse);
      await trackRequest("gRPC MainApi/GetAvailableKeys", "grpc", null, bytes);
      const metrics = await getRequestMetrics("gRPC MainApi/GetAvailableKeys", "grpc", null);
      callback(null, {
        ...baseResponse,
        payload_bytes: bytes,
        request_count_total: metrics.request_count_total,
        bytes_sent_total: metrics.bytes_sent_total,
        metrics_updated_at: metrics.updated_at || "",
      });
      return;
    }

    const { rows } = await pool.query(
      `
      SELECT DISTINCT jsonb_object_keys(data) AS nombre_dato
      FROM equipo
      WHERE id_serial = $1
      ORDER BY nombre_dato ASC
      `,
      [serialId]
    );
    const keys = rows.map((row) => row.nombre_dato);
    const baseResponse = {
      ok: true,
      message: "",
      serial_id: serialId,
      count: keys.length,
      data: keys,
      response_time_ms: elapsedMilliseconds(startedAt),
    };
    const bytes = payloadBytes(baseResponse);
    await trackRequest("gRPC MainApi/GetAvailableKeys", "grpc", serialId, bytes);
    const metrics = await getRequestMetrics("gRPC MainApi/GetAvailableKeys", "grpc", serialId);

    callback(null, {
      ...baseResponse,
      payload_bytes: bytes,
      request_count_total: metrics.request_count_total,
      bytes_sent_total: metrics.bytes_sent_total,
      metrics_updated_at: metrics.updated_at || "",
    });
  } catch (error) {
    callback(grpcError(grpc.status.INTERNAL, error.message));
  }
}

// RPC que devuelve las metricas acumuladas por nombre_dato.
async function getVariableMetricsHandler(call, callback) {
  try {
    const serialId = await resolveSerialId(call.request.serial_id);
    const keys = parseSelectedKeys(call.request.keys);
    const rows = await getVariableMetrics({
      serialId: serialId || null,
      keys,
    });

    callback(null, {
      ok: true,
      message: "",
      serial_id: serialId || "",
      selected_keys: keys,
      count: rows.length,
      data: rows.map((row) => ({
        ...row,
        updated_at: row.updated_at ? String(row.updated_at) : "",
      })),
    });
  } catch (error) {
    callback(grpcError(grpc.status.INTERNAL, error.message));
  }
}

// Crea la instancia del servidor y registra todos los metodos gRPC.
function createGrpcServer() {
  const proto = loadProto();
  const server = new grpc.Server();

  server.addService(proto.MainApi.service, {
    health: getHealth,
    getLatest,
    getOnlineValues,
    getPreset,
    getAvailableKeys,
    getVariableMetrics: getVariableMetricsHandler,
  });

  return { server, proto };
}

// Inicia el bind del servidor gRPC y devuelve la referencia para control externo.
async function startGrpcServer(bindTarget) {
  const { server, proto } = createGrpcServer();
  const target = bindTarget || "0.0.0.0:50051";

  const port = await new Promise((resolve, reject) => {
    server.bindAsync(target, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(boundPort);
    });
  });

  return {
    server,
    proto,
    port,
  };
}

module.exports = {
  PROTO_PATH,
  loadProto,
  createGrpcServer,
  startGrpcServer,
};
