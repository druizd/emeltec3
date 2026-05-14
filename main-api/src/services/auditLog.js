const crypto = require('crypto');
const pool = require('../config/db');

/**
 * Bitácora append-only de acciones críticas. Ley 21.663 §32.
 * No persiste payload literal — solo sha256 — para evitar filtrar PII en consultas.
 * Errores DB no propagan (best-effort).
 */
async function record({
  req,
  action,
  actorId = null,
  actorEmail = null,
  actorTipo = null,
  targetType = null,
  targetId = null,
  payload = null,
  statusCode = null,
  metadata = null,
}) {
  try {
    const payloadHash = payload
      ? crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      : null;
    const ip = (req && (req.ip || req.headers['x-forwarded-for'] || '')).toString().slice(0, 45);
    const userAgent = (
      req && req.headers && req.headers['user-agent'] ? req.headers['user-agent'] : ''
    )
      .toString()
      .slice(0, 255);

    await pool.query(
      `INSERT INTO audit_log
        (actor_id, actor_email, actor_tipo, action, target_type, target_id,
         payload_hash, ip, user_agent, status_code, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        actorId,
        actorEmail,
        actorTipo,
        action,
        targetType,
        targetId,
        payloadHash,
        ip || null,
        userAgent || null,
        statusCode,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
  } catch (err) {
    console.error('[audit] No se pudo registrar evento', action, err.message);
  }
}

/**
 * Middleware: registra automáticamente mutaciones (POST/PUT/PATCH/DELETE) tras
 * que el handler responde. Lee `req.user` (JWT decoded) si existe.
 *
 * Uso: aplicar a routers de recursos (companyRoutes, alertaRoutes, userRoutes).
 *
 * @param {(req: object) => { action: string, targetType?: string, targetId?: string }} resolver
 */
function auditMutations(resolver) {
  return (req, res, next) => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next();
    }
    const startedAt = Date.now();
    res.on('finish', () => {
      // No registramos errores 4xx/5xx aquí — los handlers ya pueden hacerlo
      // explícitamente con metadata. Solo mutaciones exitosas.
      if (res.statusCode >= 400) return;
      let info;
      try {
        info = resolver(req);
      } catch {
        info = { action: `${method.toLowerCase()}.unknown` };
      }
      const user = req.user || {};
      record({
        req,
        action: info.action,
        actorId: user.id || null,
        actorEmail: user.email || null,
        actorTipo: user.tipo || null,
        targetType: info.targetType || null,
        targetId: info.targetId || null,
        payload: req.body && Object.keys(req.body).length ? req.body : null,
        statusCode: res.statusCode,
        metadata: { method, path: req.originalUrl, duration_ms: Date.now() - startedAt },
      });
    });
    next();
  };
}

module.exports = { record, auditMutations };
