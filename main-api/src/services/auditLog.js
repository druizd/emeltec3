const crypto = require('crypto');
const pool = require('../config/db');

/**
 * Bitácora append-only de acciones críticas. Ley 21.663 §32.
 *
 * Qué se persiste y qué no:
 *   - `payload_hash` es el sha256 del body completo; NUNCA el body literal.
 *   - `metadata.changes` sí guarda el antes/después, pero SOLO de los campos
 *     que estén en VALUE_ALLOWLIST para ese tipo de recurso. Todo lo demás
 *     aparece como '[redactado]': se sabe QUÉ campo cambió, no su contenido.
 *     Así la bitácora sirve para reconstruir una configuración sin filtrar
 *     datos personales al consultarla (Ley 21.719).
 *
 * Errores de DB no propagan (best-effort): auditar no puede tumbar la request.
 */

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Campos cuyo VALOR puede quedar escrito en la bitácora, por tipo de recurso.
 * Todo lo que no esté acá se registra por nombre pero con el valor redactado.
 * Regla para agregar: solo configuración operativa, jamás datos de una persona
 * (email, rut, nombre, teléfono, dirección) ni secretos (password, tokens, OTP).
 */
const VALUE_ALLOWLIST = {
  alerta: [
    'nombre',
    'descripcion',
    'variable_key',
    'condicion',
    'umbral_bajo',
    'umbral_alto',
    'severidad',
    'activa',
    'cooldown_minutos',
    'dias_activos',
    'visible_to_all',
  ],
  evento: ['estado', 'resuelta', 'notificado', 'severidad'],
  // De usuario solo se audita el CONTROL DE ACCESO, nunca su identidad.
  usuario: ['tipo', 'activo', 'empresa_id', 'sub_empresa_id'],
  empresa: ['nombre', 'tipo_empresa', 'activo'],
  sitio: ['descripcion', 'tipo_sitio', 'activo', 'id_serial', 'ubicacion', 'es_maleta_piloto'],
  incidencia: ['estado', 'prioridad', 'tipo', 'titulo'],
  documento: ['nombre', 'tipo'],
  pozo_config: [
    'dga_activo',
    'dga_periodicidad',
    'dga_transport',
    'dga_fecha_inicio',
    'dga_hora_inicio',
    'profundidad_pozo_m',
    'profundidad_sensor_m',
    'caudal_max_lps',
  ],
  // `clave_informante` queda deliberadamente fuera: es un secreto de acceso a
  // SNIA. Solo se audita la referencia legible.
  dga_informante: ['referencia'],
};

/**
 * Tabla origen para leer el estado PREVIO de cada recurso. Los nombres salen
 * de esta constante, nunca del request — el id sí va parametrizado.
 */
const TABLE_BY_TARGET = {
  alerta: { table: 'alertas', pk: 'id', numericPk: true },
  evento: { table: 'alertas_eventos', pk: 'id', numericPk: false },
  usuario: { table: 'usuario', pk: 'id', numericPk: false },
  empresa: { table: 'empresa', pk: 'id', numericPk: false },
  sitio: { table: 'sitio', pk: 'id', numericPk: false },
  incidencia: { table: 'incidencias', pk: 'id', numericPk: true },
  documento: { table: 'documentos', pk: 'id', numericPk: true },
  pozo_config: { table: 'pozo_config', pk: 'sitio_id', numericPk: false },
  dga_informante: { table: 'dga_informante', pk: 'rut', numericPk: false },
  // `dato_dga` se audita con un targetId compuesto (site_id::ts), que no es una
  // pk simple: queda sin estado previo a propósito.
};

const MAX_VALUE_LEN = 200;

function outcomeForStatus(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode === 401) return 'unauthorized';
  if (statusCode === 403) return 'denied';
  if (statusCode === 404) return 'not_found';
  if (statusCode === 409) return 'conflict';
  if (statusCode >= 400) return 'invalid';
  return 'ok';
}

/** Recorta y normaliza un valor para que quepa legible en metadata. */
function normalizeValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > MAX_VALUE_LEN ? `${text.slice(0, MAX_VALUE_LEN)}…` : text;
  }
  if (typeof value === 'string' && value.length > MAX_VALUE_LEN) {
    return `${value.slice(0, MAX_VALUE_LEN)}…`;
  }
  return value;
}

/**
 * Comparación laxa: node-pg devuelve NUMERIC como string y DATE como Date, y
 * el body llega como number/string. Sin esto, guardar 300 sobre un 300 previo
 * se registraría como cambio.
 */
function sonDistintos(antes, despues) {
  if (antes === undefined) return true;
  const a = antes instanceof Date ? antes.toISOString() : antes;
  const b = despues instanceof Date ? despues.toISOString() : despues;
  if (a === null || b === null) return a !== b;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  return String(a) !== String(b);
}

/**
 * Diff entre el estado previo y el body de la mutación.
 * Devuelve los NOMBRES de todos los campos tocados y, para los permitidos,
 * el par antes/después.
 */
function computeChanges(before, body, targetType) {
  const allow = VALUE_ALLOWLIST[targetType] || [];
  const changedFields = [];
  const changes = {};
  if (!body || typeof body !== 'object') return { changedFields, changes };

  for (const key of Object.keys(body)) {
    const despues = body[key];
    const antes = before ? before[key] : undefined;
    // Con estado previo disponible, ignora los campos que el cliente reenvió
    // sin modificar — si no, cada PUT completo se vería como "cambió todo".
    if (before && !sonDistintos(antes, despues)) continue;
    changedFields.push(key);
    changes[key] = allow.includes(key)
      ? { antes: before ? normalizeValue(antes) : undefined, despues: normalizeValue(despues) }
      : '[redactado]';
  }
  return { changedFields, changes };
}

/** Snapshot de los campos auditables de un recurso, para DELETE y para el diff. */
function snapshotAllowed(row, targetType) {
  if (!row) return null;
  const allow = VALUE_ALLOWLIST[targetType] || [];
  const out = {};
  for (const key of allow) {
    if (row[key] !== undefined) out[key] = normalizeValue(row[key]);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Lee el estado previo del recurso. Best-effort: cualquier fallo devuelve null
 * y la auditoría sigue, solo que sin antes/después.
 */
async function fetchBefore(targetType, targetId) {
  const spec = TABLE_BY_TARGET[targetType];
  if (!spec || targetId === null || targetId === undefined || targetId === '') return null;
  if (spec.numericPk && !/^\d+$/.test(String(targetId))) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${spec.table} WHERE ${spec.pk}::text = $1 LIMIT 1`,
      [String(targetId)],
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[audit] No se pudo leer estado previo', targetType, targetId, err.message);
    return null;
  }
}

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
    // Solo req.ip (Express lo resuelve vía trust proxy con los hops correctos).
    // NUNCA leer X-Forwarded-For directo: el primer elemento lo controla el
    // cliente y permitiría falsificar la IP del audit_log (spoofing).
    const ip = ((req && req.ip) || '').toString().slice(0, 45);
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
 * Middleware: registra mutaciones (POST/PUT/PATCH/DELETE) tras responder el
 * handler. Lee `req.user` (JWT decoded) si existe.
 *
 * Registra TANTO las exitosas como las rechazadas: un 403 al intentar borrar
 * un recurso ajeno es justo lo que una auditoría de seguridad necesita ver.
 * El desenlace queda en `metadata.outcome` además de en `status_code`.
 *
 * Antes de ejecutar el handler toma un snapshot del recurso para poder guardar
 * el antes/después de los campos modificados (ver VALUE_ALLOWLIST).
 *
 * Uso: aplicar a routers de recursos (companyRoutes, alertaRoutes, userRoutes).
 *
 * @param {(req: object) => { action: string, targetType?: string, targetId?: string }} resolver
 *   IMPORTANTE: el resolver se invoca ANTES del router, así que no puede
 *   depender de `req.params` (aún vacío). Debe leer el id desde la URL.
 */
function auditMutations(resolver) {
  return (req, res, next) => {
    const method = req.method.toUpperCase();
    if (!MUTATION_METHODS.includes(method)) {
      return next();
    }
    const startedAt = Date.now();

    let info;
    try {
      info = resolver(req) || {};
    } catch {
      info = { action: `${method.toLowerCase()}.unknown` };
    }

    // Copia del body: algunos handlers lo mutan (defaults, normalización) y el
    // diff debe reflejar lo que pidió el cliente, no lo que quedó después.
    const bodySent =
      req.body && typeof req.body === 'object' && Object.keys(req.body).length
        ? { ...req.body }
        : null;

    const registrar = (before) => {
      res.on('finish', () => {
        const user = req.user || {};
        const outcome = outcomeForStatus(res.statusCode);
        const metadata = {
          method,
          path: req.originalUrl,
          duration_ms: Date.now() - startedAt,
          outcome,
        };

        if (outcome === 'ok') {
          if (method === 'DELETE') {
            const eliminado = snapshotAllowed(before, info.targetType);
            if (eliminado) metadata.deleted = eliminado;
          } else if (bodySent) {
            const { changedFields, changes } = computeChanges(before, bodySent, info.targetType);
            if (changedFields.length) {
              metadata.changed_fields = changedFields;
              metadata.changes = changes;
            }
          }
        } else if (bodySent) {
          // En un intento rechazado no hay cambio que registrar, pero sí
          // importa qué se intentó tocar.
          metadata.attempted_fields = Object.keys(bodySent);
        }

        record({
          req,
          action: info.action,
          actorId: user.id || null,
          actorEmail: user.email || null,
          actorTipo: user.tipo || null,
          targetType: info.targetType || null,
          targetId: info.targetId || null,
          payload: bodySent,
          statusCode: res.statusCode,
          metadata,
        });
      });
      next();
    };

    // POST crea: no hay estado previo que leer.
    if (method === 'POST' || !info.targetType || !info.targetId) {
      return registrar(null);
    }
    fetchBefore(info.targetType, info.targetId)
      .then(registrar)
      .catch(() => registrar(null));
  };
}

module.exports = {
  record,
  auditMutations,
  // Exportados para tests.
  computeChanges,
  snapshotAllowed,
  outcomeForStatus,
  sonDistintos,
  VALUE_ALLOWLIST,
  TABLE_BY_TARGET,
};
