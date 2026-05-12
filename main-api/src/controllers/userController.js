const db = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const emailService = require('../services/emailService');

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

    let query =
      'SELECT id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id FROM usuario';
    const conditions = [];
    const params = [];

    if (tipo === 'SuperAdmin') {
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`sub_empresa_id = $${params.length}`);
      } else if (queryEmpresaId) {
        params.push(queryEmpresaId);
        conditions.push(`empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Admin') {
      params.push(empresa_id);
      conditions.push(`empresa_id = $${params.length}`);
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`sub_empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Gerente') {
      if (!userSubEmpresaId) {
        return res.json({ ok: true, data: [] });
      }
      params.push(userSubEmpresaId);
      conditions.push(`sub_empresa_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY nombre ASC';

    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const { nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id } = req.body;
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
    const rawCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const codeHash = await bcrypt.hash(rawCode, 10);
    const finalEmpresaId =
      currentUser.tipo === 'Gerente'
        ? currentUser.empresa_id
        : empresa_id || currentUser.empresa_id || null;
    const finalSubEmpresaId =
      currentUser.tipo === 'Gerente' ? currentUser.sub_empresa_id : sub_empresa_id || null;

    const { rows } = await db.query(
      `INSERT INTO usuario (id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id, otp_hash, otp_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() + INTERVAL '72 hours')
       RETURNING id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id`,
      [
        newId,
        nombre,
        apellido,
        email,
        telefono || null,
        cargo || null,
        tipo,
        finalEmpresaId,
        finalSubEmpresaId,
        codeHash,
      ],
    );

    emailService.sendWelcomeEmail(email, nombre, rawCode, 4320).catch((err) => {
      console.error('Error al enviar correo:', err);
    });

    res.status(201).json({
      ok: true,
      message: `Usuario ${nombre} ${apellido} creado. Código de acceso enviado a ${email}.`,
      data: rows[0],
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
