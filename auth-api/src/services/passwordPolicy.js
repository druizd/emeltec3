/**
 * Política de contraseñas pura (sin IO), para poder testearla aislada.
 *
 * Antes la fuerza sólo se validaba en el cliente (`login.ts:scorePassword`), así
 * que cualquier llamada directa a la API podía dejar `12345678`. Este módulo es
 * la fuente de verdad del servidor y debe mantenerse en sintonía con sus dos
 * espejos: `main-api/src/services/passwordPolicy.js` y el medidor del frontend.
 * No se comparte por paquete porque `@emeltec/shared` publica TypeScript sin
 * compilar y ninguna de las dos APIs (CommonJS) lo consume.
 */

const MIN_LENGTH = 8;
// Umbral 3 (no 2): con 2 pasaban valores como "12345678" (longitud + digito).
// Exige tres de las cuatro señales: largo, mayus+minus, digito, simbolo.
const MIN_SCORE = 3;

/**
 * Puntaje 0-4. Idéntico a `scorePassword` del componente de login para que el
 * medidor de fuerza y el servidor nunca discrepen.
 */
function scorePassword(value) {
  const password = String(value ?? '');
  if (!password) return 0;

  let score = 0;
  if (password.length >= MIN_LENGTH) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length >= 12 && score < 4) score += 1;

  return Math.min(score, 4);
}

/**
 * Valida una contraseña nueva. Devuelve `{ ok: true }` o `{ ok: false, error }`
 * con un mensaje ya listo para el usuario.
 */
function validateNewPassword(value) {
  const password = String(value ?? '');

  if (password.length < MIN_LENGTH) {
    return { ok: false, error: `La contrasena debe tener al menos ${MIN_LENGTH} caracteres.` };
  }
  if (/^\d+$/.test(password)) {
    return { ok: false, error: 'La contrasena no puede ser solo numeros.' };
  }
  if (scorePassword(password) < MIN_SCORE) {
    return {
      ok: false,
      error: 'La contrasena es demasiado debil. Combina mayusculas, numeros o simbolos.',
    };
  }

  return { ok: true };
}

module.exports = {
  MIN_LENGTH,
  MIN_SCORE,
  scorePassword,
  validateNewPassword,
};
