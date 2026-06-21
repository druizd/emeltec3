// Lógica de acceso a alarmas, compartida entre cold-room (cold_room_alarm_rule)
// y agua (alertas). Pura (sin DB) para poder testearla.
//
// Modelo:
//  - Editar (crear/modificar/borrar): solo tier administrador.
//  - Ver: admin-tier ve todas; el resto solo las visible_to_all o donde esté en
//    viewer_user_ids.

const ALARM_ADMIN_TIER = ['SuperAdmin', 'Admin', 'Gerente'];

/** ¿El rol puede crear/editar/borrar alarmas? */
function canEditAlarm(role) {
  return ALARM_ADMIN_TIER.includes(role);
}

/**
 * Construye el fragmento SQL para filtrar alarmas por visibilidad según el
 * usuario. Admin-tier → sin filtro (clause null). Otros → visible_to_all o
 * estar en viewer_user_ids.
 *
 * @param {{tipo?:string, id?:string}|null|undefined} user
 * @param {string} alias  Alias de la tabla en la query (ej. 'a').
 * @param {number} nextParamIndex  Índice del próximo placeholder ($N).
 * @returns {{clause: string|null, params: any[]}}
 */
function alarmVisibilityFilter(user, alias, nextParamIndex) {
  if (canEditAlarm(user && user.tipo)) return { clause: null, params: [] };
  return {
    clause: `(${alias}.visible_to_all OR $${nextParamIndex} = ANY(${alias}.viewer_user_ids))`,
    params: [(user && user.id) || ''],
  };
}

module.exports = { ALARM_ADMIN_TIER, canEditAlarm, alarmVisibilityFilter };
