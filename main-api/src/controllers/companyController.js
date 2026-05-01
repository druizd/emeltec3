const db = require('../config/db');

/**
 * GET /api/companies/tree
 * Devuelve el árbol de jerarquía filtrado según el rol del usuario autenticado.
 *
 * SuperAdmin → todas las empresas + sub-empresas + sitios
 * Admin      → solo su empresa + sus sub-empresas + sitios
 * Gerente    → solo su empresa padre + su sub-empresa + sitios
 * Cliente    → solo su empresa padre + su sub-empresa + sitios
 */
exports.getHierarchyTree = async (req, res, next) => {
  try {
    const { tipo, empresa_id, sub_empresa_id } = req.user;

    let companies, subCompanies, sites;

    if (tipo === 'SuperAdmin') {
      // SuperAdmin: todo sin filtro
      const compRes = await db.query('SELECT id, nombre, rut, tipo_empresa FROM empresa ORDER BY nombre ASC');
      const subRes = await db.query('SELECT id, nombre, rut, empresa_id FROM sub_empresa ORDER BY nombre ASC');
      const siteRes = await db.query('SELECT id, descripcion, empresa_id, sub_empresa_id FROM sitio ORDER BY descripcion ASC');
      companies = compRes.rows;
      subCompanies = subRes.rows;
      sites = siteRes.rows;

    } else if (tipo === 'Admin') {
      // Admin: solo su empresa
      if (!empresa_id) {
        return res.json({ ok: true, data: [] });
      }
      const compRes = await db.query('SELECT id, nombre, rut, tipo_empresa FROM empresa WHERE id = $1', [empresa_id]);
      const subRes = await db.query('SELECT id, nombre, rut, empresa_id FROM sub_empresa WHERE empresa_id = $1 ORDER BY nombre ASC', [empresa_id]);
      const siteRes = await db.query(
        'SELECT id, descripcion, empresa_id, sub_empresa_id FROM sitio WHERE empresa_id = $1 ORDER BY descripcion ASC',
        [empresa_id]
      );
      companies = compRes.rows;
      subCompanies = subRes.rows;
      sites = siteRes.rows;

    } else if (tipo === 'Gerente' || tipo === 'Cliente') {
      // Gerente/Cliente: solo su sub-empresa y la empresa padre
      if (!empresa_id) {
        return res.json({ ok: true, data: [] });
      }
      const compRes = await db.query('SELECT id, nombre, rut, tipo_empresa FROM empresa WHERE id = $1', [empresa_id]);

      if (sub_empresa_id) {
        const subRes = await db.query('SELECT id, nombre, rut, empresa_id FROM sub_empresa WHERE id = $1', [sub_empresa_id]);
        const siteRes = await db.query(
          'SELECT id, descripcion, empresa_id, sub_empresa_id FROM sitio WHERE sub_empresa_id = $1 ORDER BY descripcion ASC',
          [sub_empresa_id]
        );
        subCompanies = subRes.rows;
        sites = siteRes.rows;
      } else {
        subCompanies = [];
        sites = [];
      }
      companies = compRes.rows;

    } else {
      return res.status(403).json({ ok: false, error: 'Rol no reconocido' });
    }

    // Construir árbol
    const tree = companies.map(company => ({
      ...company,
      subCompanies: subCompanies
        .filter(sc => sc.empresa_id === company.id)
        .map(sc => ({
          ...sc,
          sites: sites.filter(s => s.sub_empresa_id === sc.id)
        }))
    }));

    res.json({ ok: true, data: tree });
  } catch (err) {
    console.error('Error en getHierarchyTree:', err);
    next(err);
  }
};

/**
 * GET /api/companies
 * Lista plana de empresas, filtrada por rol.
 */
exports.getAllCompanies = async (req, res, next) => {
  try {
    const { tipo, empresa_id } = req.user;
    let query, params;

    if (tipo === 'SuperAdmin') {
      query = 'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa ORDER BY nombre ASC';
      params = [];
    } else {
      query = 'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa WHERE id = $1 ORDER BY nombre ASC';
      params = [empresa_id];
    }

    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/:id/sites
 * Sitios de una empresa o sub-empresa.
 * Valida que el usuario tenga acceso a esa entidad.
 */
exports.getCompanySites = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tipo, empresa_id, sub_empresa_id } = req.user;

    // Validar acceso según rol
    if (tipo !== 'SuperAdmin') {
      const isSubEmpresa = id.startsWith('SE');
      if (isSubEmpresa) {
        // Verificar que la sub-empresa pertenece a la empresa del usuario
        const check = await db.query(
          'SELECT id FROM sub_empresa WHERE id = $1 AND empresa_id = $2',
          [id, empresa_id]
        );
        if (check.rows.length === 0) {
          return res.status(403).json({ ok: false, error: 'No tiene acceso a esta sub-empresa' });
        }
        // Gerente y Cliente solo pueden ver su propia sub-empresa
        if ((tipo === 'Gerente' || tipo === 'Cliente') && sub_empresa_id && id !== sub_empresa_id) {
          return res.status(403).json({ ok: false, error: 'No tiene acceso a esta sub-empresa' });
        }
      } else {
        // Es una empresa directa
        if (id !== empresa_id) {
          return res.status(403).json({ ok: false, error: 'No tiene acceso a esta empresa' });
        }
      }
    }

    const column = id.startsWith('SE') ? 'sub_empresa_id' : 'empresa_id';
    const { rows } = await db.query(
      `SELECT id, descripcion, id_serial, ubicacion FROM sitio WHERE ${column} = $1 ORDER BY descripcion ASC`,
      [id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
