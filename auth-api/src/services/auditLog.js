const crypto = require('crypto');
const db = require('../config/db');

/**
 * Append-only audit log. Cumplimiento Ley 21.663 (Marco Ciberseguridad).
 *
 * Nunca persiste payload literal: solo sha256 — evita filtrar PII al revisar la
 * bitácora. Errores DB no propagan (best-effort) para no romper el request, pero
 * se loguean a stderr.
 *
 * @param {object} params
 * @param {object} params.req                       - Express request (para ip/UA).
 * @param {string} params.action                    - dotted action key, e.g. 'login.success'.
 * @param {string|null} [params.actorId]            - usuario.id; null si pre-auth.
 * @param {string|null} [params.actorEmail]         - email del actor.
 * @param {string|null} [params.actorTipo]          - rol del actor.
 * @param {string|null} [params.targetType]         - tipo de recurso afectado.
 * @param {string|null} [params.targetId]           - id del recurso afectado.
 * @param {object|null} [params.payload]            - body de la mutación; se hashea, no se persiste.
 * @param {number|null} [params.statusCode]
 * @param {object|null} [params.metadata]           - campos extra (reason, error, etc).
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

    await db.query(
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
    // No interrumpir el flujo del request si la bitácora falla.
    console.error('[audit] No se pudo registrar evento', action, err.message);
  }
}

module.exports = { record };
