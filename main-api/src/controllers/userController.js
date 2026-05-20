const db = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { formatRutForStorage } = require('../utils/rut');

const USER_PROFILE_SELECT = `
  SELECT u.id,
         u.nombre,
         COALESCE(u.apellido, '') AS apellido,
         u.rut_usuario,
         u.email,
         u.telefono,
         u.cargo,
         u.tipo,
         u.empresa_id,
         u.sub_empresa_id,
         u.last_login_at,
         u.activated_at,
         u.password_login_enabled,
         u.otp_login_enabled,
         u.two_factor_enabled,
         u.password_set_at,
         (u.password_hash IS NOT NULL) AS has_password,
         e.nombre AS empresa_nombre,
         se.nombre AS sub_empresa_nombre
  FROM usuario u
  LEFT JOIN empresa e ON e.id = u.empresa_id
  LEFT JOIN sub_empresa se ON se.id = u.sub_empresa_id
`;

async function getUserProfileById(userId) {
  const { rows } = await db.query(`${USER_PROFILE_SELECT} WHERE u.id = $1`, [userId]);
  return rows[0] || null;
}

exports.getEmpresas = async (req, res, next) => {
  try {
    const { tipo, empresa_id } = req.user;
    let empresaRows;

    if (tipo === 'SuperAdmin') {
      const { rows } = await db.query(
        'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa ORDER BY nombre ASC',
      );
      empresaRows = rows;
    } else if ((tipo === 'Admin' || tipo === 'Gerente' || tipo === 'Cliente') && empresa_id) {
      const { rows } = await db.query(
        'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa WHERE id = $1',
        [empresa_id],
      );
      empresaRows = rows;
    } else {
      return res.json({ ok: true, data: [] });
    }

    const data = await Promise.all(
      empresaRows.map(async (emp) => {
        const { rows: subs } = await db.query(
          'SELECT id, nombre FROM sub_empresa WHERE empresa_id = $1 ORDER BY nombre ASC',
          [emp.id],
        );
        return { ...emp, sub_empresas: subs };
      }),
    );

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.getAllUsers = async (req, res, next) => {
  try {
    const { tipo, empresa_id, sub_empresa_id: userSubEmpresaId } = req.user;
    const { sub_empresa_id, empresa_id: queryEmpresaId } = req.query;

    if (tipo === 'Cliente') {
      return res.status(403).json({ ok: false, error: 'No tiene permisos para ver usuarios' });
    }

    let query = `
      SELECT u.id,
             u.nombre,
             COALESCE(u.apellido, '') AS apellido,
             u.rut_usuario,
             u.email,
             u.telefono,
             u.cargo,
             u.tipo,
             u.empresa_id,
             u.sub_empresa_id,
             u.last_login_at,
             u.activated_at,
             u.password_login_enabled,
             u.otp_login_enabled,
             u.two_factor_enabled,
             u.password_set_at,
             (u.password_hash IS NOT NULL) AS has_password,
             e.nombre AS empresa_nombre,
             se.nombre AS sub_empresa_nombre
      FROM usuario u
      LEFT JOIN empresa e ON e.id = u.empresa_id
      LEFT JOIN sub_empresa se ON se.id = u.sub_empresa_id
    `;
    const conditions = [];
    const params = [];

    if (tipo === 'SuperAdmin') {
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`u.sub_empresa_id = $${params.length}`);
      } else if (queryEmpresaId) {
        params.push(queryEmpresaId);
        conditions.push(`u.empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Admin') {
      params.push(empresa_id);
      conditions.push(`u.empresa_id = $${params.length}`);
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`u.sub_empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Gerente') {
      if (!userSubEmpresaId) {
        return res.json({ ok: true, data: [] });
      }
      params.push(userSubEmpresaId);
      conditions.push(`u.sub_empresa_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY u.nombre ASC';

    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getCurrentUser = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }

    const profile = await getUserProfileById(userId);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.updateCurrentUser = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'email')) {
      return res.status(400).json({ ok: false, error: 'El correo no se puede editar.' });
    }

    const allowed = ['nombre', 'apellido', 'rut_usuario', 'telefono', 'cargo'];
    const updates = [];
    const values = [];

    for (const field of allowed) {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;

      let value = req.body[field];
      if (typeof value === 'string') value = value.trim();
      if (field === 'nombre' && !value) {
        return res.status(400).json({ ok: false, error: 'El nombre es requerido.' });
      }
      if (field === 'rut_usuario') value = value ? formatRutForStorage(value) : null;
      if (field !== 'nombre' && value === '') value = null;

      values.push(value);
      updates.push(`${field} = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'No hay datos para actualizar.' });
    }

    values.push(userId);
    await db.query(
      `UPDATE usuario SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
      values,
    );

    const profile = await getUserProfileById(userId);
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.updateCurrentPassword = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const { current_password, new_password } = req.body;

    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }
    if (!new_password || String(new_password).length < 8) {
      return res
        .status(400)
        .json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    const { rows } = await db.query(
      'SELECT password_hash, password_login_enabled FROM usuario WHERE id = $1',
      [userId],
    );
    const currentHash = rows[0]?.password_hash || null;
    const currentPasswordRequired = currentHash && rows[0]?.password_login_enabled;

    if (currentPasswordRequired) {
      const matches = await bcrypt.compare(String(current_password || ''), currentHash);
      if (!matches) {
        return res.status(401).json({ ok: false, error: 'La contraseña actual no coincide.' });
      }
    }

    const nextHash = await bcrypt.hash(String(new_password), 12);
    await db.query(
      `UPDATE usuario
       SET password_hash = $1,
           password_set_at = NOW(),
           password_login_enabled = true,
           activated_at = COALESCE(activated_at, NOW()),
           updated_at = NOW()
       WHERE id = $2`,
      [nextHash, userId],
    );

    const profile = await getUserProfileById(userId);
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.updateCurrentSecurity = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Usuario no autenticado' });
    }

    const { rows } = await db.query(
      `SELECT password_hash, password_login_enabled, otp_login_enabled, two_factor_enabled
       FROM usuario WHERE id = $1`,
      [userId],
    );
    const current = rows[0];
    if (!current) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

    const passwordLogin =
      req.body.password_login_enabled === undefined
        ? current.password_login_enabled
        : Boolean(req.body.password_login_enabled);
    const otpLogin =
      req.body.otp_login_enabled === undefined
        ? current.otp_login_enabled
        : Boolean(req.body.otp_login_enabled);
    const twoFactor =
      req.body.two_factor_enabled === undefined
        ? current.two_factor_enabled
        : Boolean(req.body.two_factor_enabled);

    if (!passwordLogin && !otpLogin) {
      return res
        .status(400)
        .json({ ok: false, error: 'Debe quedar al menos un método de inicio activo.' });
    }
    if (passwordLogin && !current.password_hash) {
      return res.status(400).json({
        ok: false,
        error: 'Crea una contraseña antes de activar el ingreso con contraseña.',
      });
    }
    if (twoFactor && (!passwordLogin || !current.password_hash)) {
      return res.status(400).json({
        ok: false,
        error: 'El 2FA requiere una contraseña activa.',
      });
    }

    await db.query(
      `UPDATE usuario
       SET password_login_enabled = $1,
           otp_login_enabled = $2,
           two_factor_enabled = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [passwordLogin, otpLogin, twoFactor, userId],
    );

    const profile = await getUserProfileById(userId);
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const {
      nombre,
      apellido,
      rut_usuario,
      email,
      telefono,
      cargo,
      tipo,
      empresa_id,
      sub_empresa_id,
    } = req.body;
    const currentUser = req.user;

    if (!nombre || !apellido || !email || !tipo) {
      return res
        .status(400)
        .json({ ok: false, error: 'nombre, apellido, email y tipo son requeridos.' });
    }

    if (currentUser.tipo === 'Admin') {
      if (empresa_id && empresa_id !== currentUser.empresa_id) {
        return res
          .status(403)
          .json({ ok: false, error: 'No puede crear usuarios en otra empresa.' });
      }
      if (tipo === 'SuperAdmin') {
        return res.status(403).json({ ok: false, error: 'No puede crear usuarios SuperAdmin.' });
      }
    } else if (currentUser.tipo === 'Gerente') {
      if (
        (empresa_id && empresa_id !== currentUser.empresa_id) ||
        (sub_empresa_id && sub_empresa_id !== currentUser.sub_empresa_id)
      ) {
        return res
          .status(403)
          .json({ ok: false, error: 'No puede crear usuarios fuera de su division.' });
      }
      if (tipo === 'SuperAdmin' || tipo === 'Admin') {
        return res.status(403).json({ ok: false, error: 'No tiene permisos para crear este rol.' });
      }
    }

    const newId = 'U' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const finalEmpresaId =
      currentUser.tipo === 'Gerente'
        ? currentUser.empresa_id
        : empresa_id || currentUser.empresa_id || null;
    const finalSubEmpresaId =
      currentUser.tipo === 'Gerente' ? currentUser.sub_empresa_id : sub_empresa_id || null;
    const rutUsuario = rut_usuario === undefined ? null : formatRutForStorage(rut_usuario);

    const { rows } = await db.query(
      `INSERT INTO usuario (
         id, nombre, apellido, rut_usuario, email, telefono, cargo, tipo,
         empresa_id, sub_empresa_id, password_login_enabled, otp_login_enabled, two_factor_enabled
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,false,false
       )
       RETURNING id`,
      [
        newId,
        nombre,
        apellido,
        rutUsuario || null,
        email,
        telefono || null,
        cargo || null,
        tipo,
        finalEmpresaId,
        finalSubEmpresaId,
      ],
    );

    const created = await getUserProfileById(rows[0].id);

    res.status(201).json({
      ok: true,
      message: `Usuario ${nombre} ${apellido} creado. La cuenta se activara en su primer ingreso.`,
      data: created,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res
        .status(409)
        .json({ ok: false, error: `El correo ${req.body.email} ya esta registrado.` });
    }
    next(err);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    if (currentUser.tipo === 'Admin' || currentUser.tipo === 'Gerente') {
      const check = await db.query(
        'SELECT empresa_id, sub_empresa_id, tipo FROM usuario WHERE id = $1',
        [id],
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
      }
      const targetUser = check.rows[0];

      if (currentUser.tipo === 'Admin' && targetUser.empresa_id !== currentUser.empresa_id) {
        return res
          .status(403)
          .json({ ok: false, error: 'No puede eliminar usuarios de otra empresa' });
      }

      if (currentUser.tipo === 'Gerente') {
        if (targetUser.sub_empresa_id !== currentUser.sub_empresa_id) {
          return res
            .status(403)
            .json({ ok: false, error: 'No puede eliminar usuarios de otra division' });
        }
        if (targetUser.tipo === 'SuperAdmin' || targetUser.tipo === 'Admin') {
          return res
            .status(403)
            .json({ ok: false, error: 'No tiene permiso para eliminar a este usuario' });
        }
      }
    }

    await db.query('DELETE FROM usuario WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Usuario eliminado' });
  } catch (err) {
    next(err);
  }
};
