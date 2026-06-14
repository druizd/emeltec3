/**
 * Middleware de autorización para las rutas /api/data/*.
 *
 * Resuelve el serial del request y verifica que pertenezca al alcance del
 * usuario (EMT-C01). Setea req.dataSerial:
 *  - serial pedido y propio → req.dataSerial = serial
 *  - serial pedido ajeno    → 403 (corta la cadena)
 *  - sin serial             → último serial del propio usuario (puede ser null)
 */
const pool = require('../config/db');
const { resolveAccessibleSerial } = require('../services/dataAccess');

async function requireDataSerialAccess(req, res, next) {
  try {
    // Express convierte ?serial_id=a&serial_id=b en array. Lo normalizamos a
    // escalar (primer valor) para no pasar un array al filtro SQL.
    let requested = req.query.serial_id || req.query.id_serial || null;
    if (Array.isArray(requested)) requested = requested[0] || null;
    const result = await resolveAccessibleSerial(pool, req.user, requested);
    if (result.forbidden) {
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre este equipo' });
    }
    req.dataSerial = result.serial;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireDataSerialAccess };
