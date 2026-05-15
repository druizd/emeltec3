const pool = require('../config/db');

const TARGET_TYPES = ['usuario', 'empresa', 'alerta', 'evento', 'incidencia', 'sitio'];

/**
 * GET /api/audit-log
 *
 * Filtros opcionales:
 *   - sitio_id: limita a acciones que afectaron alertas/eventos/incidencias del sitio.
 *   - empresa_id: limita a acciones cuyo actor pertenece a la empresa.
 *   - target_type: usuario | empresa | alerta | evento | incidencia | sitio
 *   - action: filtro exacto (e.g. 'alerta.update')
 *   - desde / hasta: rango ISO timestamps sobre ts.
 *   - page / limit: paginación.
 *
 * Scope por rol:
 *   - SuperAdmin: ve todo el global, salvo filtros explícitos.
 *   - Resto: solo acciones cuyo actor pertenece a su empresa.
 */
exports.listarAuditLog = async (req, res) => {
  const {
    sitio_id,
    empresa_id,
    target_type,
    action,
    desde,
    hasta,
    page = 1,
    limit = 50,
  } = req.query;

  const isSuperAdmin = req.user.tipo === 'SuperAdmin';
  const params = [];
  const conditions = [];

  // Scope por empresa del actor cuando no es SuperAdmin
  if (!isSuperAdmin) {
    params.push(req.user.empresa_id);
    conditions.push(`actor_emp.empresa_id = $${params.length}`);
  } else if (empresa_id) {
    params.push(empresa_id);
    conditions.push(`actor_emp.empresa_id = $${params.length}`);
  }

  if (target_type) {
    if (!TARGET_TYPES.includes(target_type)) {
      return res
        .status(400)
        .json({ ok: false, error: `target_type inválido. Use: ${TARGET_TYPES.join(', ')}` });
    }
    params.push(target_type);
    conditions.push(`al.target_type = $${params.length}`);
  }

  if (action) {
    params.push(action);
    conditions.push(`al.action = $${params.length}`);
  }

  if (desde) {
    params.push(desde);
    conditions.push(`al.ts >= $${params.length}`);
  }
  if (hasta) {
    params.push(hasta);
    conditions.push(`al.ts <= $${params.length}`);
  }

  if (sitio_id) {
    params.push(sitio_id);
    const pSitio = params.length;
    conditions.push(`(
      (al.target_type = 'sitio' AND al.target_id = $${pSitio})
      OR (al.target_type = 'alerta' AND a_rule.sitio_id = $${pSitio})
      OR (al.target_type = 'evento' AND a_evt.sitio_id = $${pSitio})
      OR (al.target_type = 'incidencia' AND inc.sitio_id = $${pSitio})
    )`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const limitPh = params.length + 1;
  const offsetPh = params.length + 2;
  const listParams = [...params, parseInt(limit, 10), offset];

  const joinClause = `
    LEFT JOIN usuario actor_emp ON actor_emp.id = al.actor_id
    LEFT JOIN alertas a_rule    ON al.target_type = 'alerta'    AND a_rule.id::text = al.target_id
    LEFT JOIN alertas_eventos a_evt ON al.target_type = 'evento' AND a_evt.id::text = al.target_id
    LEFT JOIN incidencias inc   ON al.target_type = 'incidencia' AND inc.id::text  = al.target_id
  `;

  const { rows } = await pool.query(
    `SELECT al.id, al.ts, al.actor_id, al.actor_email, al.actor_tipo,
            al.action, al.target_type, al.target_id, al.status_code, al.metadata,
            al.ip,
            COALESCE(
              a_rule.sitio_id,
              a_evt.sitio_id,
              inc.sitio_id,
              CASE WHEN al.target_type = 'sitio' THEN al.target_id END
            ) AS resolved_sitio_id
       FROM audit_log al
       ${joinClause}
       ${where}
       ORDER BY al.ts DESC
       LIMIT $${limitPh} OFFSET $${offsetPh}`,
    listParams,
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM audit_log al ${joinClause} ${where}`,
    params,
  );

  res.json({
    ok: true,
    data: rows,
    total: parseInt(countRows[0].count, 10),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });
};
