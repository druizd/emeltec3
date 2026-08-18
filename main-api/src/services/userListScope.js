/**
 * Alcance del listado de usuarios (`GET /api/users`).
 *
 * Vive fuera del controller para poder probarse sin arrastrar la conexión a
 * base de datos, y porque la decisión de "quién ve a quién" merece un solo
 * lugar explícito.
 *
 * CIERRA POR DEFECTO: cualquier tipo no contemplado queda denegado. Antes esta
 * lógica era un if/else dentro del handler y un tipo desconocido no entraba en
 * ningún branch, así que la consulta salía SIN WHERE y devolvía todos los
 * usuarios del sistema. `usuario.tipo` es VARCHAR(30) sin CHECK en el esquema:
 * basta un typo ('admin' en minúscula) o un rol nuevo para llegar ahí.
 *
 * @param {{tipo: string, empresa_id?: string, sub_empresa_id?: string}} user
 * @param {{sub_empresa_id?: string, empresa_id?: string}} filtros query params
 * @returns {{allow: false} | {allow: true, empty: true} | {allow: true, conditions: string[], params: unknown[]}}
 */
function buildUserListScope(user, filtros = {}) {
  const tipo = user?.tipo;
  const { sub_empresa_id: qSubEmpresa, empresa_id: qEmpresa } = filtros;

  if (tipo === 'SuperAdmin') {
    const conditions = [];
    const params = [];
    if (qSubEmpresa) {
      params.push(qSubEmpresa);
      conditions.push(`u.sub_empresa_id = $${params.length}`);
    } else if (qEmpresa) {
      params.push(qEmpresa);
      conditions.push(`u.empresa_id = $${params.length}`);
    }
    return { allow: true, conditions, params };
  }

  if (tipo === 'Admin' || tipo === 'Vendedor') {
    const conditions = [];
    const params = [user.empresa_id];
    conditions.push('u.empresa_id = $1');
    if (user.sub_empresa_id) {
      params.push(user.sub_empresa_id);
      conditions.push(`u.sub_empresa_id = $${params.length}`);
    }
    return { allow: true, conditions, params };
  }

  if (tipo === 'Gerente') {
    // Un Gerente sin división asignada no tiene a quién ver.
    if (!user.sub_empresa_id) return { allow: true, empty: true };
    return {
      allow: true,
      conditions: ['u.sub_empresa_id = $1'],
      params: [user.sub_empresa_id],
    };
  }

  // Cliente y cualquier tipo desconocido.
  return { allow: false };
}

module.exports = { buildUserListScope };
