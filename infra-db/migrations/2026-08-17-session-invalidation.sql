-- Invalidación de sesiones al cambiar la contraseña.
--
-- Los JWT son stateless (HS256, TTL 1h, sin refresh ni jti), así que hasta ahora
-- un restablecimiento de contraseña NO cerraba las sesiones abiertas: si
-- reseteabas porque te habían comprometido, el atacante conservaba acceso hasta
-- una hora. Esta columna es el corte: todo token cuyo claim `iat` sea anterior a
-- `sessions_valid_from` se rechaza en el middleware `protect`.
--
-- NULL = sin corte (comportamiento previo). No se rellena para usuarios
-- existentes a propósito: hacerlo cerraría todas las sesiones activas al
-- desplegar.

ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ;

COMMENT ON COLUMN usuario.sessions_valid_from IS
  'Corte de validez de sesiones: se rechaza todo JWT emitido antes de este instante. Se setea al cambiar/restablecer la contraseña. NULL = sin corte.';
