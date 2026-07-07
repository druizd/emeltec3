/**
 * Control de acceso a datos por serial/sitio.
 *
 * Modelo ESTRICTO (decisión de negocio jun-2026, ver
 * docs/security-audit/INFORME-AUDITORIA-SEGURIDAD-2026-06.md EMT-C01/C02/H07):
 *  - SuperAdmin: acceso total.
 *  - Admin: debe coincidir empresa_id.
 *  - Gerente/Cliente: deben coincidir empresa_id Y sub_empresa_id.
 *
 * Las funciones que tocan BD reciben `pool` por parámetro para poder testearlas
 * con un pool falso (sin conexión real).
 */

/**
 * ¿El valor representa "sin sub-empresa asignada"? (null, undefined o '').
 */
function noSubEmpresa(value) {
  return value === null || value === undefined || value === '';
}

/**
 * ¿Puede el usuario acceder al sitio dado?
 * Modelo (decisión jun-2026):
 *  - SuperAdmin: todo. Admin: su empresa.
 *  - Gerente/Cliente CON sub-empresa: estricto a su empresa Y sub-empresa.
 *  - Gerente/Cliente SIN sub-empresa asignada: toda su empresa.
 * @param {{tipo:string, empresa_id?:any, sub_empresa_id?:any}|null} user
 * @param {{empresa_id:any, sub_empresa_id:any}|null} site
 */
function canAccessSite(user, site) {
  if (!user) return false;
  if (user.tipo === 'SuperAdmin') return true;
  if (!site) return false;
  // Vendedor: equipo comercial Emeltec — mismo alcance que Admin, siempre
  // asociado a la empresa interna (demos + Maletas Piloto).
  if (user.tipo === 'Admin' || user.tipo === 'Vendedor') return user.empresa_id === site.empresa_id;
  if (user.tipo === 'Gerente' || user.tipo === 'Cliente') {
    if (user.empresa_id !== site.empresa_id) return false;
    // Sin sub-empresa asignada → acceso a toda la empresa.
    if (noSubEmpresa(user.sub_empresa_id)) return true;
    // Con sub-empresa → estricto a su sub-empresa.
    return user.sub_empresa_id === site.sub_empresa_id;
  }
  return false;
}

/**
 * Construye el filtro SQL de sitios accesibles para el usuario.
 * Devuelve { clause, params }. clause vacío = sin restricción (SuperAdmin).
 * @param {object} user
 * @param {string} alias alias de la tabla sitio en la query
 * @param {number} startIndex índice inicial de placeholders ($N). Permite
 *   componer la cláusula dentro de queries que ya usan parámetros previos.
 */
function buildUserSiteScope(user, alias = 's', startIndex = 1) {
  if (!user || user.tipo === 'SuperAdmin') {
    return { clause: '', params: [] };
  }
  if (user.tipo === 'Admin' || user.tipo === 'Vendedor') {
    return { clause: `${alias}.empresa_id = $${startIndex}`, params: [user.empresa_id] };
  }
  if (user.tipo === 'Gerente' || user.tipo === 'Cliente') {
    // Sin sub-empresa asignada → toda la empresa (igual que Admin).
    if (noSubEmpresa(user.sub_empresa_id)) {
      return { clause: `${alias}.empresa_id = $${startIndex}`, params: [user.empresa_id] };
    }
    return {
      clause: `${alias}.empresa_id = $${startIndex} AND ${alias}.sub_empresa_id = $${startIndex + 1}`,
      params: [user.empresa_id, user.sub_empresa_id],
    };
  }
  // Rol desconocido: sin acceso. Cláusula imposible para no filtrar de más.
  return { clause: 'FALSE', params: [] };
}

/**
 * Devuelve los sitios (empresa_id, sub_empresa_id) asociados a un serial.
 * Un serial mapea a sitio vía sitio.id_serial.
 */
async function lookupSitesBySerial(pool, serial) {
  const { rows } = await pool.query(
    `SELECT empresa_id, sub_empresa_id FROM sitio WHERE id_serial = $1`,
    [serial],
  );
  return rows;
}

/**
 * ¿Puede el usuario leer datos de este serial?
 * SuperAdmin siempre. Resto: el serial debe mapear a un sitio accesible.
 * Un serial sin sitio asociado se deniega (no se puede verificar propiedad).
 */
async function userCanAccessSerial(pool, user, serial) {
  if (user && user.tipo === 'SuperAdmin') return true;
  const sites = await lookupSitesBySerial(pool, serial);
  if (sites.length === 0) return false;
  return sites.some((site) => canAccessSite(user, site));
}

/**
 * Último serial con datos dentro del alcance del usuario (decisión 4).
 * Nunca devuelve un serial fuera del alcance del usuario.
 */
async function getLatestSerialForUser(pool, user) {
  const scope = buildUserSiteScope(user, 's');
  const where = scope.clause ? `WHERE ${scope.clause}` : '';
  const { rows } = await pool.query(
    `SELECT e.id_serial
     FROM equipo e
     JOIN sitio s ON s.id_serial = e.id_serial
     ${where}
     ORDER BY e.time DESC
     LIMIT 1`,
    scope.params,
  );
  return rows[0]?.id_serial || null;
}

/**
 * Resuelve el serial a usar para un request de datos, aplicando autorización.
 *  - Si se pidió un serial: verifica propiedad → { serial } o { forbidden:true }.
 *  - Si no se pidió: devuelve el último serial del propio usuario → { serial }
 *    (puede ser null si el usuario no tiene equipos).
 */
async function resolveAccessibleSerial(pool, user, requestedSerial) {
  if (requestedSerial) {
    const allowed = await userCanAccessSerial(pool, user, requestedSerial);
    if (!allowed) return { forbidden: true };
    return { serial: requestedSerial };
  }
  const serial = await getLatestSerialForUser(pool, user);
  return { serial };
}

/** Busca el alcance (empresa/sub) de un sitio por su id. null si no existe. */
async function lookupSiteById(pool, siteId) {
  const { rows } = await pool.query(`SELECT empresa_id, sub_empresa_id FROM sitio WHERE id = $1`, [
    siteId,
  ]);
  return rows[0] || null;
}

/**
 * ¿El usuario puede acceder al sitio identificado por id? Útil para validar
 * sitio_id provisto en el body al CREAR registros (alerta/incidencia/documento).
 * SuperAdmin siempre; un sitio inexistente se deniega para no-Super.
 */
async function userCanAccessSiteId(pool, user, siteId) {
  if (user && user.tipo === 'SuperAdmin') return true;
  const site = await lookupSiteById(pool, siteId);
  if (!site) return false;
  return canAccessSite(user, site);
}

/**
 * Dado un array de siteIds, devuelve los que el usuario NO puede acceder
 * (EMT-C02). SuperAdmin nunca deniega. Un sitio inexistente se considera
 * denegado (no se puede verificar propiedad). `lookupSiteFn(siteId)` debe
 * devolver { empresa_id, sub_empresa_id } o null.
 */
async function findUnauthorizedSites(siteIds, user, lookupSiteFn) {
  if (user && user.tipo === 'SuperAdmin') return [];
  const denied = [];
  for (const siteId of siteIds) {
    const site = await lookupSiteFn(siteId);
    if (!site || !canAccessSite(user, site)) denied.push(siteId);
  }
  return denied;
}

module.exports = {
  canAccessSite,
  buildUserSiteScope,
  lookupSitesBySerial,
  userCanAccessSerial,
  getLatestSerialForUser,
  resolveAccessibleSerial,
  findUnauthorizedSites,
  lookupSiteById,
  userCanAccessSiteId,
};
