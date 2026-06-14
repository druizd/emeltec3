/**
 * Controlador de metricas acumuladas.
 * Expone metricas generales por endpoint y metricas agregadas por variable.
 */
const pool = require('../config/db');
const { getVariableMetrics } = require('../services/metricsService');
const { buildUserSiteScope, resolveAccessibleSerial } = require('../services/dataAccess');

function parseRequestedKeys(query) {
  const rawValues = [
    query.keys,
    query.key,
    query.nombre_dato,
    query.nombre_datos,
    query.variable,
    query.variables,
  ];

  return [
    ...new Set(
      rawValues
        .flatMap((value) => {
          if (Array.isArray(value)) return value;
          if (value === undefined || value === null) return [];
          return String(value).split(',');
        })
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
}

async function getMetrics(req, res, next) {
  try {
    const { domain, serial_id } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (domain) {
      where += ` AND domain_slug = $${params.length + 1}`;
      params.push(domain);
    }
    if (serial_id) {
      where += ` AND serial_id = $${params.length + 1}`;
      params.push(serial_id);
    }

    // Scope por tenant: limitar a los seriales de los sitios del usuario.
    // Sin esto, un usuario veía métricas de uso de TODOS los clientes.
    if (req.user && req.user.tipo !== 'SuperAdmin') {
      const scope = buildUserSiteScope(req.user, 's', params.length + 1);
      where += ` AND serial_id IN (
        SELECT s.id_serial FROM sitio s WHERE ${scope.clause || 'FALSE'}
      )`;
      params.push(...scope.params);
    }

    const { rows } = await pool.query(
      `SELECT endpoint, domain_slug, serial_id, request_count, bytes_sent, updated_at
       FROM api_metrics
       ${where}
       ORDER BY request_count DESC, bytes_sent DESC`,
      params,
    );

    return res.json({
      ok: true,
      filters: { domain: domain || null, serial_id: serial_id || null },
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
}

async function getMetricsByVariable(req, res, next) {
  try {
    const { serial_id } = req.query;
    const keys = parseRequestedKeys(req.query);
    // Autoriza el serial (o resuelve el último del propio usuario si no se pide).
    // Antes caía al último serial GLOBAL (fuga entre clientes).
    const resolution = await resolveAccessibleSerial(pool, req.user, serial_id || null);
    if (resolution.forbidden) {
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre este equipo' });
    }
    const resolvedSerialId = resolution.serial;
    const rows = await getVariableMetrics({
      serialId: resolvedSerialId || null,
      keys,
    });

    return res.json({
      ok: true,
      filters: {
        serial_id: resolvedSerialId || null,
        selected_keys: keys,
      },
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMetrics, getMetricsByVariable };
