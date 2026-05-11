/**
 * Controladores principales de lectura sobre la tabla equipo.
 * Exponen consultas historicas, por preset y una vista "online"
 * con el ultimo valor conocido de cada variable por equipo.
 */
const pool = require("../config/db");
const { getLatestSerialId } = require("../utils/serial");
const { CHILE_TIME_ZONE, formatChileTimestamp, parseChileTimestamp } = require("../utils/timezone");
const {
  trackRequest,
  getRequestMetrics,
  registerVariableMetrics,
} = require("../services/metricsService");

const PRESET_ALIASES = {
  "24h": { amount: 24, unit: "hours", canonical: "24h" },
  "7d": { amount: 7, unit: "days", canonical: "7d" },
  "30d": { amount: 30, unit: "days", canonical: "30d" },
  "365d": { amount: 365, unit: "days", canonical: "365d" },
  "1y": { amount: 365, unit: "days", canonical: "365d" },
  "1a": { amount: 365, unit: "days", canonical: "365d" },
  "1year": { amount: 365, unit: "days", canonical: "365d" },
};

function payloadBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

function elapsedMilliseconds(startedAt) {
  if (typeof startedAt !== "bigint") {
    return 0;
  }

  const elapsedNs = process.hrtime.bigint() - startedAt;
  return Math.max(0, Math.round(Number(elapsedNs) / 1e6));
}

function collectHistoryKeys(rows) {
  return [...new Set(
    rows.flatMap((row) => Object.keys(row?.data || {}))
  )];
}

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
      filters: {
        ...filters,
        selected_keys: [key],
      },
      count: projectedRows.length,
      data: projectedRows,
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

function buildOnlineVariableMetricEntries(filters, rows, serialId, durationMs) {
  const selectedKeys = Array.isArray(filters?.selected_keys) ? filters.selected_keys : [];
  const keysToTrack = selectedKeys.length
    ? selectedKeys
    : [...new Set(rows.map((row) => row.nombre_dato).filter(Boolean))];

  if (!keysToTrack.length) {
    return [];
  }

  const durationShare = Math.max(0, Math.round(durationMs / keysToTrack.length));

  return keysToTrack.map((key) => {
    const projectedRows = rows.filter((row) => row.nombre_dato === key);
    const snapshot = Object.fromEntries(
      projectedRows.map((row) => [row.nombre_dato, row.valor_dato])
    );
    const payload = {
      ok: true,
      filters: {
        ...filters,
        selected_keys: [key],
      },
      count: projectedRows.length,
      data: projectedRows,
      snapshot,
    };

    return {
      nombre_dato: key,
      serial_id: serialId,
      bytes_sent: payloadBytes(payload),
      duration_ms: durationShare,
    };
  });
}

async function respond(res, filters, rows, endpoint, serialId, options = {}) {
  const { extras = {}, durationMs = 0, variableMetrics = [] } = options;
  const basePayload = {
    ok: true,
    filters,
    count: Array.isArray(rows) ? rows.length : 0,
    data: rows,
    ...extras,
  };
  const bytes = payloadBytes(basePayload);

  await trackRequest(endpoint, "data", serialId, bytes);
  await registerVariableMetrics(variableMetrics);
  const metrics = await getRequestMetrics(endpoint, "data", serialId);

  return res.json({
    ...basePayload,
    payload_bytes: bytes,
    response_time_ms: durationMs,
    metrics,
  });
}

function sendMissing(res, ...params) {
  return res.status(400).json({
    ok: false,
    message: `Los parametros ${params.join(", ")} son obligatorios`,
  });
}

async function resolveSerialId(candidateSerialId) {
  if (candidateSerialId) {
    return candidateSerialId;
  }

  return getLatestSerialId(pool);
}

async function respondWithoutAvailableSerial(res, endpoint, startedAt, extras = {}) {
  return respond(
    res,
    {
      serial_id: null,
      selected_keys: [],
    },
    [],
    endpoint,
    null,
    {
      extras: {
        message: "No hay registros disponibles todavia.",
        ...extras,
      },
      durationMs: elapsedMilliseconds(startedAt),
    }
  );
}

function parseLimit(limit, fallback = 100) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 5000);
}

function parseOptionalLimit(limit, fallback = 500) {
  if (limit === undefined || limit === null || String(limit).trim() === "") {
    return null;
  }

  return parseLimit(limit, fallback);
}

function normalizePreset(rawPreset) {
  return PRESET_ALIASES[String(rawPreset || "").trim().toLowerCase()] || null;
}

function parseSelectedKeys(query) {
  const rawValues = [
    query.keys,
    query.key,
    query.nombre_dato,
    query.nombre_datos,
    query.variable,
    query.variables,
  ];

  const normalized = rawValues
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value === undefined || value === null) return [];
      return String(value).split(",");
    })
    .map((value) => String(value).trim())
    .filter(Boolean);

  return [...new Set(normalized)];
}

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

function parseTimestampLiteral(rawValue) {
  return parseChileTimestamp(rawValue);
}

function formatTimestampLiteral(date) {
  return formatChileTimestamp(date);
}

function chileDateSql(column) {
  return `TO_CHAR(${column} AT TIME ZONE '${CHILE_TIME_ZONE}', 'YYYY-MM-DD')`;
}

function chileTimeSql(column) {
  return `TO_CHAR(${column} AT TIME ZONE '${CHILE_TIME_ZONE}', 'HH24:MI:SS')`;
}

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

async function getData(req, res, next) {
  const startedAt = process.hrtime.bigint();

  try {
    const { serial_id, id_serial, limit } = req.query;
    const serialValue = await resolveSerialId(serial_id || id_serial);
    const selectedKeys = parseSelectedKeys(req.query);

    if (!serialValue) {
      return respondWithoutAvailableSerial(res, "GET /api/data", startedAt);
    }

    const parsedLimit = parseLimit(limit, 100);
    const rows = await executeHistoryQuery({
      serialId: serialValue,
      selectedKeys,
      limit: parsedLimit,
    });

    const filters = {
      serial_id: serialValue,
      selected_keys: selectedKeys,
      limit: parsedLimit,
    };
    const durationMs = elapsedMilliseconds(startedAt);

    return respond(res, filters, rows, "GET /api/data", serialValue, {
      durationMs,
      variableMetrics: buildHistoryVariableMetricEntries(
        filters,
        rows,
        {},
        selectedKeys,
        serialValue,
        durationMs
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function getLatest(req, res, next) {
  const startedAt = process.hrtime.bigint();

  try {
    const { serial_id, id_serial } = req.query;
    const serialValue = await resolveSerialId(serial_id || id_serial);
    const selectedKeys = parseSelectedKeys(req.query);

    if (!serialValue) {
      return respondWithoutAvailableSerial(res, "GET /api/data/latest", startedAt);
    }

    const rows = await executeHistoryQuery({
      serialId: serialValue,
      selectedKeys,
      limit: 1,
    });

    const filters = {
      serial_id: serialValue,
      selected_keys: selectedKeys,
    };
    const durationMs = elapsedMilliseconds(startedAt);

    return respond(res, filters, rows, "GET /api/data/latest", serialValue, {
      durationMs,
      variableMetrics: buildHistoryVariableMetricEntries(
        filters,
        rows,
        {},
        selectedKeys,
        serialValue,
        durationMs
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function getByRange(req, res, next) {
  const startedAt = process.hrtime.bigint();

  try {
    const { serial_id, id_serial, from, to, limit } = req.query;
    const serialValue = await resolveSerialId(serial_id || id_serial);
    const selectedKeys = parseSelectedKeys(req.query);

    if (!from || !to) {
      return sendMissing(res, "from", "to");
    }

    if (!serialValue) {
      return respondWithoutAvailableSerial(res, "GET /api/data/range", startedAt);
    }

    const parsedLimit = parseOptionalLimit(limit, 500);
    const rows = await executeHistoryQuery({
      serialId: serialValue,
      selectedKeys,
      from,
      to,
      limit: parsedLimit,
    });

    const filters = {
      serial_id: serialValue,
      selected_keys: selectedKeys,
      from,
      to,
      limit: parsedLimit,
    };
    const durationMs = elapsedMilliseconds(startedAt);

    return respond(res, filters, rows, "GET /api/data/range", serialValue, {
      durationMs,
      variableMetrics: buildHistoryVariableMetricEntries(
        filters,
        rows,
        {},
        selectedKeys,
        serialValue,
        durationMs
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function getByPreset(req, res, next) {
  const startedAt = process.hrtime.bigint();

  try {
    const { serial_id, id_serial, preset, base_date, limit } = req.query;
    const serialValue = await resolveSerialId(serial_id || id_serial);
    const selectedKeys = parseSelectedKeys(req.query);
    const normalizedPreset = normalizePreset(preset);

    if (!preset) {
      return sendMissing(res, "preset");
    }

    if (!normalizedPreset) {
      return res.status(400).json({
        ok: false,
        message: "Preset invalido. Usa 24h, 7d, 30d o 365d",
      });
    }

    if (!serialValue) {
      return respondWithoutAvailableSerial(res, "GET /api/data/preset", startedAt);
    }

    const resolvedBaseDate =
      base_date || (await getLatestReferenceTimestamp(serialValue));

    if (!resolvedBaseDate) {
      const filters = {
        serial_id: serialValue,
        selected_keys: selectedKeys,
        preset: normalizedPreset.canonical,
        base_date: null,
        from: null,
        to: null,
        limit: parseOptionalLimit(limit, 500),
      };
      const extras = { message: "No hay registros para ese serial." };
      const durationMs = elapsedMilliseconds(startedAt);

      return respond(
        res,
        filters,
        [],
        "GET /api/data/preset",
        serialValue,
        {
          extras,
          durationMs,
          variableMetrics: buildHistoryVariableMetricEntries(
            filters,
            [],
            extras,
            selectedKeys,
            serialValue,
            durationMs
          ),
        }
      );
    }

    const endDate = parseTimestampLiteral(resolvedBaseDate);
    if (!endDate) {
      return res.status(400).json({
        ok: false,
        message: "base_date no tiene un formato valido",
      });
    }

    const parsedLimit = parseOptionalLimit(limit, 500);
    const { from, to } = buildRangeFromPreset(normalizedPreset, endDate);

    const rows = await executeHistoryQuery({
      serialId: serialValue,
      selectedKeys,
      from,
      to,
      limit: parsedLimit,
    });

    const filters = {
      serial_id: serialValue,
      selected_keys: selectedKeys,
      preset: normalizedPreset.canonical,
      base_date: formatTimestampLiteral(endDate),
      from,
      to,
      limit: parsedLimit,
    };
    const durationMs = elapsedMilliseconds(startedAt);

    return respond(res, filters, rows, "GET /api/data/preset", serialValue, {
      durationMs,
      variableMetrics: buildHistoryVariableMetricEntries(
        filters,
        rows,
        {},
        selectedKeys,
        serialValue,
        durationMs
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function getAvailableKeys(req, res, next) {
  const startedAt = process.hrtime.bigint();

  try {
    const { serial_id, id_serial } = req.query;
    const serialValue = await resolveSerialId(serial_id || id_serial);

    if (!serialValue) {
      return respondWithoutAvailableSerial(res, "GET /api/data/keys", startedAt);
    }

    const { rows } = await pool.query(
      `
      SELECT DISTINCT jsonb_object_keys(data) AS nombre_dato
      FROM equipo
      WHERE id_serial = $1
      ORDER BY nombre_dato ASC
      `,
      [serialValue]
    );

    const keys = rows.map((row) => row.nombre_dato);

    return respond(
      res,
      {
        serial_id: serialValue,
      },
      keys,
      "GET /api/data/keys",
      serialValue,
      {
        durationMs: elapsedMilliseconds(startedAt),
      }
    );
  } catch (err) {
    next(err);
  }
}

async function getOnlineValues(req, res, next) {
  const startedAt = process.hrtime.bigint();

  try {
    const { serial_id, id_serial } = req.query;
    const serialValue = await resolveSerialId(serial_id || id_serial);
    const selectedKeys = parseSelectedKeys(req.query);

    if (!serialValue) {
      return respondWithoutAvailableSerial(
        res,
        "GET /api/data/online",
        startedAt,
        { snapshot: {} }
      );
    }

    const params = [serialValue];
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

    const snapshot = Object.fromEntries(
      mapped.map((row) => [row.nombre_dato, row.valor_dato])
    );

    const filters = {
      serial_id: serialValue,
      selected_keys: selectedKeys,
    };
    const durationMs = elapsedMilliseconds(startedAt);

    return respond(res, filters, mapped, "GET /api/data/online", serialValue, {
      extras: { snapshot },
      durationMs,
      variableMetrics: buildOnlineVariableMetricEntries(
        filters,
        mapped,
        serialValue,
        durationMs
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function insertData(req, res, next) {
  try {
    return res.status(501).json({
      ok: false,
      message: "Insercion no implementada en esta etapa.",
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  insertData,
  getData,
  getLatest,
  getByRange,
  getByPreset,
  getAvailableKeys,
  getOnlineValues,
};
