/**
 * Visibilidad de las reglas de alarma de cámaras de frío.
 *
 * `visible_to_all` y `viewer_user_ids` existen desde la migración
 * 2026-06-21-alarm-visibility, que los creó para AMBOS sistemas de alarmas
 * (cold_room_alarm_rule y alertas) y documenta la regla:
 * "Admin/Gerente/SuperAdmin ven todas; el filtro aplica solo a otros roles".
 *
 * En cámaras nunca se aplicó: el listado hacía `SELECT *` y devolvía
 * visibleToAll/viewerUserIds al frontend sin usarlos, así que marcar una regla
 * como restringida no restringía nada.
 *
 * Vive fuera del router para poder probarse sin levantar media app, y porque
 * la decisión de quién ve qué merece un lugar explícito.
 */

/** Roles que administran alarmas de cámara: los mismos que nombra la migración. */
const ALARM_ADMIN_ROLES = ['SuperAdmin', 'Admin', 'Gerente'];

/**
 * @param {{id?: string, tipo?: string} | null} user
 * @param {number} startIndex índice del primer placeholder libre
 * @returns {{clause: string, params: unknown[]}} clause vacío = sin restricción
 */
function alarmRuleVisibilityScope(user, startIndex) {
  // Quien puede crear, editar y borrar una regla tiene que poder verla.
  if (user && ALARM_ADMIN_ROLES.includes(user.tipo)) {
    return { clause: '', params: [] };
  }
  return {
    clause: ` AND (visible_to_all = TRUE OR $${startIndex} = ANY(viewer_user_ids))`,
    params: [user?.id ?? ''],
  };
}

module.exports = { alarmRuleVisibilityScope, ALARM_ADMIN_ROLES };
