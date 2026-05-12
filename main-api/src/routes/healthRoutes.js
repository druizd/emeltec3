/**
 * Ruta minima de salud para comprobar proceso HTTP y conexion a la base.
 */
const express = require('express');
const pool = require('../config/db');
const router = express.Router();

/** GET /api/health — verifica que la API y PostgreSQL estén operativos. */
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW() AS server_time');
    return res.json({
      ok: true,
      message: 'API principal operativa',
      database: 'Conexión exitosa',
      server_time: rows[0].server_time,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: 'Error al conectar con PostgreSQL',
      error: err.message,
    });
  }
});

module.exports = router;
