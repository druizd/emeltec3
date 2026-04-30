const db = require('../config/db');
const bcrypt = require('bcrypt');
const emailService = require('../services/emailService'); // Importamos el servicio de correos

exports.getAllUsers = async (req, res, next) => {
  try {
    const { sub_empresa_id, empresa_id } = req.query;
    let query = 'SELECT id, nombre, email, tipo, empresa_id, sub_empresa_id FROM usuario';
    let params = [];

    if (sub_empresa_id) {
      query += ' WHERE sub_empresa_id = $1';
      params.push(sub_empresa_id);
    } else if (empresa_id) {
      query += ' WHERE empresa_id = $1';
      params.push(empresa_id);
    }

    query += ' ORDER BY nombre ASC';
    const { rows } = await db.query(query, params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getEmpresas = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nombre, rut, sitios, tipo_empresa FROM empresa ORDER BY nombre ASC'
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const { nombre, email, password, tipo, empresa_id, sub_empresa_id } = req.body;
    
    // Hash de contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { rows } = await db.query(
      'INSERT INTO usuario (nombre, email, password, tipo, empresa_id, sub_empresa_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre, email, tipo',
      [nombre, email, hashedPassword, tipo, empresa_id, sub_empresa_id]
    );

    const newUser = rows[0];

    // DISPARAR ENVÍO DE CORREO (Async)
    // No bloqueamos la respuesta del API, el correo se envía en segundo plano
    emailService.sendWelcomeEmail(email, nombre, password).catch(err => {
      console.error('Error al enviar correo de bienvenida:', err);
    });

    res.status(201).json({ ok: true, data: newUser });
  } catch (err) {
    next(err);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM usuario WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Usuario eliminado' });
  } catch (err) {
    next(err);
  }
};
