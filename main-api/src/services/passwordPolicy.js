/**
 * Espejo de `auth-api/src/services/passwordPolicy.js`.
 *
 * Duplicado a propósito: `@emeltec/shared` publica TypeScript sin compilar y
 * ninguna de las dos APIs (CommonJS) lo consume en runtime. Si cambias los
 * umbrales acá, cambialos también en auth-api y en el medidor de fuerza del
 * componente de login del frontend.
 */

const MIN_LENGTH = 8;
const MIN_SCORE = 3;

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

function validateNewPassword(value) {
  const password = String(value ?? '');

  if (password.length < MIN_LENGTH) {
    return { ok: false, error: `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.` };
  }
  if (/^\d+$/.test(password)) {
    return { ok: false, error: 'La contraseña no puede ser solo números.' };
  }
  if (scorePassword(password) < MIN_SCORE) {
    return {
      ok: false,
      error: 'La contraseña es demasiado débil. Combina mayúsculas, números o símbolos.',
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
