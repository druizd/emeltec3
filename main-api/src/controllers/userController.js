const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const emailService = require('../services/emailService');

// ✅ FUNCIÓN QUE FALTABA — alimenta el dropdown de empresas
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

exports.getAllUsers = async (req, res, next) => {
  try {
    const { sub_empresa_id, empresa_id } = req.query;
    let query = 'SELECT id, nombre, apellido, email, tipo, empresa_id, sub_empresa_id FROM usuario';
    let params = [];
    if (sub_empresa_id) { query += ' WHERE sub_empresa_id = $1'; params.push(sub_empresa_id); }
    else if (empresa_id) { query += ' WHERE empresa_id = $1'; params.push(empresa_id); }
    query += ' ORDER BY nombre ASC';
    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
};

// ✅ CORREGIDO — genera contraseña, acepta todos los campos del formulario
exports.createUser = async (req, res, next) => {
  try {
    const { nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id } = req.body;

    if (!nombre || !apellido || !email || !tipo) {
      return res.status(400).json({ ok: false, error: 'nombre, apellido, email y tipo son requeridos.' });
    }

    const newId = 'U' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const rawPassword = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 caracteres alfanuméricos (letras y números)

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(rawPassword, salt);

    const { rows } = await db.query(
      `INSERT INTO usuario (id, nombre, apellido, email, telefono, cargo, tipo, empresa_id, sub_empresa_id, otp_hash, otp_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() + INTERVAL '72 hours')
       RETURNING id, nombre, apellido, email, tipo`,
      [newId, nombre, apellido, email, telefono||null, cargo||null, tipo, empresa_id||null, sub_empresa_id||null, hashedPassword]
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

exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM usuario WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Usuario eliminado' });
  } catch (err) { next(err); }
};
