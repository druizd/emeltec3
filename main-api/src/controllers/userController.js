const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../services/emailService');

/**
 * GET /api/users/empresas
 * Devuelve empresas disponibles para el dropdown de creación de usuarios.
 * Filtrado por rol del usuario autenticado.
 */
exports.getEmpresas = async (req, res, next) => {
  try {
    const { tipo, empresa_id } = req.user;
    let empresaRows;

    if (tipo === 'SuperAdmin') {
      const { rows } = await db.query('SELECT id, nombre, tipo_empresa FROM empresa ORDER BY nombre ASC');
      empresaRows = rows;
    } else if (tipo === 'Admin' && empresa_id) {
      const { rows } = await db.query('SELECT id, nombre, tipo_empresa FROM empresa WHERE id = $1', [empresa_id]);
      empresaRows = rows;
    } else {
      return res.json({ ok: true, data: [] });
    }

    // Anidar sub-empresas en cada empresa
    const data = await Promise.all(empresaRows.map(async (emp) => {
      const { rows: subs } = await db.query(
        'SELECT id, nombre FROM sub_empresa WHERE empresa_id = $1 ORDER BY nombre ASC',
        [emp.id]
      );
      return { ...emp, sub_empresas: subs };
    }));

    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

/**
 * GET /api/users
 * Lista usuarios filtrada por rol:
 *   SuperAdmin → todos (acepta filtros opcionales)
 *   Admin      → solo usuarios de su empresa
 *   Gerente    → solo usuarios de su sub-empresa (lectura)
 *   Cliente    → 403 Prohibido
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const { tipo, empresa_id, sub_empresa_id: userSubEmpresaId } = req.user;
    const { sub_empresa_id, empresa_id: queryEmpresaId } = req.query;

    // Cliente no puede listar usuarios
    if (tipo === 'Cliente') {
      return res.status(403).json({ ok: false, error: 'No tiene permisos para ver usuarios' });
    }

    let query = 'SELECT id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id FROM usuario';
    let conditions = [];
    let params = [];

    if (tipo === 'SuperAdmin') {
      // SuperAdmin puede filtrar por cualquier empresa/sub-empresa
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`sub_empresa_id = $${params.length}`);
      } else if (queryEmpresaId) {
        params.push(queryEmpresaId);
        conditions.push(`empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Admin') {
      // Admin solo ve usuarios de su empresa
      params.push(empresa_id);
      conditions.push(`empresa_id = $${params.length}`);
      // Puede filtrar por sub-empresa dentro de su empresa
      if (sub_empresa_id) {
        params.push(sub_empresa_id);
        conditions.push(`sub_empresa_id = $${params.length}`);
      }
    } else if (tipo === 'Gerente') {
      // Gerente solo ve usuarios de su sub-empresa
      if (userSubEmpresaId) {
        params.push(userSubEmpresaId);
        conditions.push(`sub_empresa_id = $${params.length}`);
      } else {
        return res.json({ ok: true, data: [] });
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY nombre ASC';

    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
};

/**
 * POST /api/users
 * Crea un nuevo usuario. Solo Admin y SuperAdmin (validado en middleware).
 * Admin solo puede crear usuarios en su empresa.
 */
exports.createUser = async (req, res, next) => {
  try {
    const { nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id } = req.body;
    const currentUser = req.user;

    if (!nombre || !apellido || !email || !tipo) {
      return res.status(400).json({ ok: false, error: 'nombre, apellido, email y tipo son requeridos.' });
    }

    // Validar que Admin solo cree usuarios en su propia empresa
    if (currentUser.tipo === 'Admin') {
      if (empresa_id && empresa_id !== currentUser.empresa_id) {
        return res.status(403).json({ ok: false, error: 'No puede crear usuarios en otra empresa.' });
      }
      // No puede crear SuperAdmins
      if (tipo === 'SuperAdmin') {
        return res.status(403).json({ ok: false, error: 'No puede crear usuarios SuperAdmin.' });
      }
    } else if (currentUser.tipo === 'Gerente') {
      // Validar que Gerente solo cree usuarios en su propia sub-empresa
      if ((empresa_id && empresa_id !== currentUser.empresa_id) || (sub_empresa_id && sub_empresa_id !== currentUser.sub_empresa_id)) {
        return res.status(403).json({ ok: false, error: 'No puede crear usuarios fuera de su división.' });
      }
      // Gerente solo puede crear Gerentes o Clientes
      if (tipo === 'SuperAdmin' || tipo === 'Admin') {
        return res.status(403).json({ ok: false, error: 'No tiene permisos para crear este rol.' });
      }
    }

    const newId = 'U' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const rawPassword = crypto.randomBytes(3).toString('hex').toUpperCase();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    // Usar la empresa/sub-empresa del creador si no se especifica o si es Gerente
    const finalEmpresaId = currentUser.tipo === 'Gerente' ? currentUser.empresa_id : (empresa_id || currentUser.empresa_id || null);
    const finalSubEmpresaId = currentUser.tipo === 'Gerente' ? currentUser.sub_empresa_id : (sub_empresa_id || null);

    const { rows } = await db.query(
      `INSERT INTO usuario (id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id, otp_hash, otp_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() + INTERVAL '72 hours')
       RETURNING id, nombre, apellido, email, telefono, cargo, tipo`,
      [newId, nombre, apellido, email, telefono || null, cargo || null, tipo, finalEmpresaId, finalSubEmpresaId, hashedPassword]
    );

    emailService.sendWelcomeEmail(email, nombre, rawPassword).catch(err => {
      console.error('Error al enviar correo:', err);
    });

    res.status(201).json({
      ok: true,
      message: `Usuario ${nombre} ${apellido} creado. Código de acceso enviado a ${email}.`,
      data: rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: `El correo ${req.body.email} ya está registrado.` });
    }
    next(err);
  }
};

/**
 * DELETE /api/users/:id
 * Elimina un usuario. Solo Admin y SuperAdmin (validado en middleware).
 * Admin solo puede eliminar usuarios de su empresa.
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    // Admin o Gerente solo pueden eliminar usuarios de su jurisdicción
    if (currentUser.tipo === 'Admin' || currentUser.tipo === 'Gerente') {
      const check = await db.query('SELECT empresa_id, sub_empresa_id, tipo FROM usuario WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
      }
      const targetUser = check.rows[0];

      if (currentUser.tipo === 'Admin') {
        if (targetUser.empresa_id !== currentUser.empresa_id) {
          return res.status(403).json({ ok: false, error: 'No puede eliminar usuarios de otra empresa' });
        }
      } else if (currentUser.tipo === 'Gerente') {
        if (targetUser.sub_empresa_id !== currentUser.sub_empresa_id) {
          return res.status(403).json({ ok: false, error: 'No puede eliminar usuarios de otra división' });
        }
        if (targetUser.tipo === 'SuperAdmin' || targetUser.tipo === 'Admin') {
          return res.status(403).json({ ok: false, error: 'No tiene permiso para eliminar a este usuario' });
        }
      }
    }

    await db.query('DELETE FROM usuario WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Usuario eliminado' });
  } catch (err) { next(err); }
};
