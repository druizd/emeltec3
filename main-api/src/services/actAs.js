/**
 * Modo "ver como" (act_as) de SuperAdmin — reglas compartidas por los dos
 * `protect` (v2 `middlewares/auth.ts` y legacy `middlewares/authMiddleware.js`).
 *
 * Un token "ver como" lo emite un SuperAdmin real (POST /api/v2/auth/view-as) y
 * lleva el rol y alcance elegidos en los claims habituales (`tipo`, `empresa_id`,
 * `sub_empresa_id`), de modo que todos los chequeos de alcance existentes se
 * aplican solos. Además lleva `act_as: true` y `real_sub` (id del SuperAdmin).
 *
 * Es SOLO LECTURA: `protect` rechaza cualquier método que no sea GET/HEAD/OPTIONS.
 * La revocación de sesión se evalúa contra el SuperAdmin real, no contra `id`.
 */

/** Roles que un SuperAdmin puede simular. */
const VIEW_AS_ROLES = ['Admin', 'Gerente', 'Cliente', 'Vendedor'];

/** Vigencia del token "ver como" (30 minutos). */
const VIEW_AS_TTL_SECONDS = 30 * 60;

/**
 * `id` que lleva el token "ver como". No es el del SuperAdmin a propósito: los
 * alcances por usuario (usuario_sitio del Vendedor, alertas creadas por o
 * visibles para un usuario) filtran por `req.user.id`, y con el id real el
 * SuperAdmin heredaría sus propias asignaciones en vez de ver lo que ve el rol.
 * Cabe en audit_log.actor_id (VARCHAR(10)) y no coincide con ningún usuario.
 */
const VIEW_AS_USER_ID = 'view-as';

const READ_ONLY_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const READ_ONLY_ERROR = 'Modo "ver como" es solo lectura';

/** ¿El payload decodificado es un token "ver como"? */
function isActAsToken(decoded) {
  return decoded?.act_as === true;
}

/**
 * Un token act_as solo es válido si apunta a un SuperAdmin real (`real_sub`) y
 * a un rol simulable. Cualquier otra cosa se trata como token inválido.
 */
function isValidActAsToken(decoded) {
  return (
    isActAsToken(decoded) &&
    typeof decoded.real_sub === 'string' &&
    decoded.real_sub.length > 0 &&
    VIEW_AS_ROLES.includes(decoded.tipo)
  );
}

function isReadOnlyMethod(method) {
  return READ_ONLY_METHODS.includes(String(method || '').toUpperCase());
}

/**
 * Sujeto contra el que se evalúa `sessions_valid_from`: el SuperAdmin real si el
 * token es act_as; si no, el propio payload.
 */
function revocationSubject(decoded) {
  if (isActAsToken(decoded)) return { id: decoded.real_sub, iat: decoded.iat };
  return decoded;
}

/** Valor de `req.actAs` para un token act_as. */
function actAsContext(decoded) {
  return { realUserId: decoded.real_sub };
}

module.exports = {
  VIEW_AS_ROLES,
  VIEW_AS_TTL_SECONDS,
  VIEW_AS_USER_ID,
  READ_ONLY_ERROR,
  isActAsToken,
  isValidActAsToken,
  isReadOnlyMethod,
  revocationSubject,
  actAsContext,
};
