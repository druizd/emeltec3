/**
 * Servicio de metricas de uso de la API.
 * Mantiene metricas generales por endpoint y metricas agregadas por variable.
 */
const pool = require('../config/db');

function normalizeMetricValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.round(parsed);
}

async function trackRequest(endpoint, domainSlug, serialId, bytesSent) {
  try {
    await pool.query(
      `INSERT INTO api_metrics (
         endpoint,
         domain_slug,
         serial_id,
         request_count,
         bytes_sent,
         updated_at
       )
       VALUES ($1, $2, $3, 1, $4, NOW())
       ON CONFLICT (endpoint, domain_slug, serial_id)
       DO UPDATE SET
         request_count = api_metrics.request_count + 1,
         bytes_sent = api_metrics.bytes_sent + EXCLUDED.bytes_sent,
         updated_at = NOW()`,
      [endpoint, domainSlug || null, serialId || null, normalizeMetricValue(bytesSent)],
    );
  } catch (err) {
    console.error('[metrics] Error al registrar endpoint:', err.message);
  }
}

async function getRequestMetrics(endpoint, domainSlug, serialId) {
  try {
    const { rows } = await pool.query(
      `SELECT
         request_count,
         bytes_sent,
         updated_at
       FROM api_metrics
       WHERE endpoint = $1
         AND domain_slug IS NOT DISTINCT FROM $2
         AND serial_id IS NOT DISTINCT FROM $3
       LIMIT 1`,
      [endpoint, domainSlug || null, serialId || null],
    );

    if (rows.length === 0) {
      return {
        request_count_total: 0,
        bytes_sent_total: 0,
        updated_at: null,
      };
    }

    return {
      request_count_total: Number(rows[0].request_count) || 0,
      bytes_sent_total: Number(rows[0].bytes_sent) || 0,
      updated_at: rows[0].updated_at || null,
    };
  } catch (err) {
    console.error('[metrics] Error al consultar endpoint:', err.message);

    return {
      request_count_total: 0,
      bytes_sent_total: 0,
      updated_at: null,
    };
  }
}

async function registerVariableMetric(nombreDato, serialId, bytesSent, durationMs = 0) {
  try {
    if (!nombreDato) {
      return;
    }

    await pool.query(
      `
      INSERT INTO public.api_variable_metrics (
        nombre_dato,
        serial_id,
        request_count,
        bytes_sent,
        duration_ms_total,
        updated_at
      )
      VALUES ($1, $2, 1, $3, $4, NOW())
      ON CONFLICT (nombre_dato, serial_id)
      DO UPDATE SET
        request_count = api_variable_metrics.request_count + 1,
        bytes_sent = api_variable_metrics.bytes_sent + EXCLUDED.bytes_sent,
        duration_ms_total = api_variable_metrics.duration_ms_total + EXCLUDED.duration_ms_total,
        updated_at = NOW()
      `,
      [
        nombreDato,
        serialId || null,
        normalizeMetricValue(bytesSent),
        normalizeMetricValue(durationMs),
      ],
    );
  } catch (err) {
    console.error('[metrics] Error al registrar variable:', err.message);
  }
}

async function registerVariableMetrics(entries = []) {
  for (const entry of entries) {
    await registerVariableMetric(
      entry?.nombre_dato,
      entry?.serial_id,
      entry?.bytes_sent,
      entry?.duration_ms,
    );
  }
}

async function getVariableMetrics({ serialId = null, keys = [] } = {}) {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (serialId) {
      params.push(serialId);
      where += ` AND serial_id = $${params.length}`;
    }

    if (Array.isArray(keys) && keys.length > 0) {
      params.push(keys);
      where += ` AND nombre_dato = ANY($${params.length}::text[])`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        nombre_dato,
        serial_id,
        request_count,
        bytes_sent,
        duration_ms_total,
        updated_at
      FROM public.api_variable_metrics
      ${where}
      ORDER BY bytes_sent DESC, request_count DESC, nombre_dato ASC
      `,
      params,
    );

    return rows.map((row) => {
      const requestCount = Number(row.request_count) || 0;
      const bytesSent = Number(row.bytes_sent) || 0;
      const durationMsTotal = Number(row.duration_ms_total) || 0;

      return {
        nombre_dato: row.nombre_dato,
        serial_id: row.serial_id,
        request_count: requestCount,
        bytes_sent: bytesSent,
        bytes_sent_kb: Number((bytesSent / 1024).toFixed(2)),
        duration_ms_total: durationMsTotal,
        avg_duration_ms: requestCount > 0 ? Number((durationMsTotal / requestCount).toFixed(2)) : 0,
        updated_at: row.updated_at || null,
      };
    });
  } catch (err) {
    console.error('[metrics] Error al consultar variables:', err.message);
    return [];
  }
}

module.exports = {
  trackRequest,
  getRequestMetrics,
  registerVariableMetric,
  registerVariableMetrics,
  getVariableMetrics,
};
