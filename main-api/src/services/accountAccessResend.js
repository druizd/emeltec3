/**
 * Decisión de si corresponde reenviar la invitación de acceso a una cuenta
 * (`POST /api/users/:id/reenviar-acceso`).
 *
 * Vive fuera del controller por lo mismo que `userListScope`: se puede probar
 * sin arrastrar la conexión a base de datos, y la regla de "a quién sirve este
 * reenvío" merece un solo lugar explícito.
 *
 * La invitación solo es útil mientras la cuenta sigue en el flujo de activación
 * (`activated_at IS NULL` y sin `password_hash`): es el estado en que auth-api
 * la enruta a `POST /api/auth/setup/start`, donde define su contraseña y recibe
 * el código. Con contraseña ya definida el correo no habilita nada — y la
 * plataforma no manda contraseñas por correo a propósito, así que la salida
 * correcta es el restablecimiento (destructivo, con 2FA), no un reenvío.
 *
 * @param {{activo?: boolean, activated_at?: unknown, has_password?: boolean}} target
 * @returns {{status: number, code: string, error: string} | null} null = se puede reenviar
 */
function rechazoReenvioAcceso(target) {
  if (!target) {
    return { status: 404, code: 'USUARIO_NO_ENCONTRADO', error: 'Usuario no encontrado' };
  }
  if (target.activo === false) {
    return {
      status: 409,
      code: 'CUENTA_DESACTIVADA',
      error: 'La cuenta está desactivada. Reactívala antes de reenviar el acceso.',
    };
  }
  if (target.has_password === true || target.activated_at) {
    return {
      status: 409,
      code: 'CUENTA_YA_ACTIVA',
      error:
        'Esta cuenta ya definió su contraseña. Si el usuario la perdió, usa Restablecer acceso.',
    };
  }
  return null;
}

module.exports = { rechazoReenvioAcceso };
