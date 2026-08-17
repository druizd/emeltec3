/**
 * Invalidación de sesiones tras cambiar la contraseña.
 *
 * Los JWT son stateless (HS256, 1h, sin refresh ni `jti`), así que la única
 * forma de cortar una sesión viva es contrastar el claim `iat` contra un corte
 * guardado en DB: `usuario.sessions_valid_from` (migración
 * 2026-08-17-session-invalidation.sql).
 *
 * Coste: una consulta por request autenticado. Se amortigua con un cache en
 * proceso de TTL corto — la contrapartida es que revocar tarda hasta
 * SESSION_REVOCATION_TTL_MS en propagarse (por defecto 30 s, frente a los 3600 s
 * que duraba antes una sesión comprometida).
 *
 * Ante error de DB se falla ABIERTO (se permite el token) a propósito: si la DB
 * no responde, el resto de la API tampoco funciona, y fallar cerrado convertiría
 * cualquier hipo de la base en un cierre de sesión masivo. El error queda en
 * stderr.
 */

const CACHE_TTL_MS = Number.parseInt(process.env.SESSION_REVOCATION_TTL_MS || '30000', 10);

// El pool se resuelve perezosamente: así los tests lo sustituyen sin depender
// del mockeo de módulos CommonJS, y cargar este archivo no abre una conexión.
let poolRef = null;
function getPool() {
  if (!poolRef) poolRef = require('../config/db');
  return poolRef;
}

/** userId -> { validFromMs: number|null, expiresAt: number } */
const cache = new Map();

function readCache(userId) {
  const hit = cache.get(userId);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(userId);
    return undefined;
  }
  return hit.validFromMs;
}

async function loadSessionsValidFrom(userId) {
  const cached = readCache(userId);
  if (cached !== undefined) return cached;

  const { rows } = await getPool().query('SELECT sessions_valid_from FROM usuario WHERE id = $1', [
    userId,
  ]);
  const raw = rows[0]?.sessions_valid_from ?? null;
  const validFromMs = raw ? new Date(raw).getTime() : null;

  cache.set(userId, { validFromMs, expiresAt: Date.now() + CACHE_TTL_MS });
  return validFromMs;
}

/**
 * ¿El token quedó invalidado por un cambio de contraseña posterior?
 *
 * La comparación es a nivel de SEGUNDO porque `iat` no tiene más resolución:
 * sólo se revoca un token emitido en un segundo estrictamente anterior al
 * corte. Sin eso, un token emitido en el mismo segundo del cambio se rechazaría
 * por redondeo.
 *
 * @param {{ id?: string|number, iat?: number }} decoded - payload del JWT ya verificado.
 * @returns {Promise<boolean>}
 */
async function isSessionRevoked(decoded) {
  const userId = decoded?.id;
  const iat = decoded?.iat;
  if (!userId || !Number.isFinite(iat)) return false;

  try {
    const validFromMs = await loadSessionsValidFrom(userId);
    if (!validFromMs) return false;
    return Math.floor(validFromMs / 1000) > iat;
  } catch (err) {
    console.error('[sessionRevocation] No se pudo verificar el corte de sesion:', err.message);
    return false;
  }
}

/** Limpia el cache de un usuario (tras cambiar su contraseña en este proceso). */
function forget(userId) {
  if (userId) cache.delete(userId);
}

/** Sólo para tests. */
function _resetCache() {
  cache.clear();
}

/** Sólo para tests: sustituye el pool (pasar null restaura el real). */
function _setPool(pool) {
  poolRef = pool;
}

module.exports = { isSessionRevoked, forget, _resetCache, _setPool, CACHE_TTL_MS };
