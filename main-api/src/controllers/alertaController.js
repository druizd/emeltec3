const pool = require('../config/db');

const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

function normalizarDiasActivos(dias) {
  if (!Array.isArray(dias) || dias.length === 0) return DIAS_VALIDOS;
  return [...new Set(dias.map((d) => String(d).toLowerCase().trim()))].filter((d) =>
    DIAS_VALIDOS.includes(d),
  );
}

function esSuperAdmin(req) {
  return req.user?.tipo === 'SuperAdmin';
}

function tieneAccesoAAlerta(req, alerta) {
  return esSuperAdmin(req) || alerta.creado_por === req.user.id;
}

exports.crearAlerta = async (req, res) => {
  const {
    nombre,
    descripcion,
    sitio_id,
    empresa_id,
    variable_key,
    condicion,
    umbral_bajo,
    umbral_alto,
    severidad = 'media',
    cooldown_minutos = 5,
    dias_activos,
  } = req.body;

  if (!nombre || !sitio_id || !empresa_id || !variable_key || !condicion) {
    return res.status(400).json({
      ok: false,
      error: 'Campos requeridos: nombre, sitio_id, empresa_id, variable_key, condicion',
    });
  }

  if (req.user.tipo !== 'SuperAdmin' && empresa_id !== req.user.empresa_id) {
    return res
      .status(403)
      .json({ ok: false, error: 'No puedes crear alertas en una empresa que no es la tuya' });
  }

  const sub_empresa_id = req.user.sub_empresa_id ?? null;
  const diasActivos = normalizarDiasActivos(dias_activos);
  if (!diasActivos.length) {
    return res
      .status(400)
      .json({ ok: false, error: 'Debe seleccionar al menos un dia activo valido' });
  }

  const { rows } = await pool.query(
    `INSERT INTO alertas
       (nombre, descripcion, sitio_id, empresa_id, sub_empresa_id, variable_key,
        condicion, umbral_bajo, umbral_alto, severidad, cooldown_minutos, dias_activos, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      nombre,
      descripcion ?? null,
      sitio_id,
      empresa_id,
      sub_empresa_id,
      variable_key,
      condicion,
      umbral_bajo ?? null,
      umbral_alto ?? null,
      severidad,
      cooldown_minutos,
      diasActivos,
      req.user.id,
    ],
  );

  res.status(201).json({ ok: true, data: rows[0] });
};

exports.listarAlertas = async (req, res) => {
  const { sitio_id, empresa_id, activa } = req.query;
  const params = [];
  const conditions = [];

  if (esSuperAdmin(req)) {
    if (empresa_id) {
      params.push(empresa_id);
      conditions.push(`a.empresa_id = $${params.length}`);
    }
  } else {
    params.push(req.user.id);
    conditions.push(`a.creado_por = $${params.length}`);
  }

  if (sitio_id) {
    params.push(sitio_id);
    conditions.push(`a.sitio_id = $${params.length}`);
  }
  if (activa !== undefined) {
    params.push(activa === 'true');
    conditions.push(`a.activa = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT a.*, s.descripcion AS sitio_desc, s.id_serial, e.nombre AS empresa_nombre
       FROM alertas a
       JOIN sitio s ON s.id = a.sitio_id
       LEFT JOIN empresa e ON e.id = a.empresa_id
       ${where}
      ORDER BY a.severidad DESC, a.created_at DESC`,
    params,
  );

  res.json({ ok: true, data: rows });
};

exports.obtenerAlerta = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT a.*, s.descripcion AS sitio_desc, s.id_serial, e.nombre AS empresa_nombre
       FROM alertas a
       JOIN sitio s ON s.id = a.sitio_id
       LEFT JOIN empresa e ON e.id = a.empresa_id
      WHERE a.id = $1`,
    [id],
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Alerta no encontrada' });

  const alerta = rows[0];
  if (!tieneAccesoAAlerta(req, alerta)) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a esta alerta' });
  }

  res.json({ ok: true, data: alerta });
};

exports.actualizarAlerta = async (req, res) => {
  const { id } = req.params;
  const { rows: existing } = await pool.query('SELECT * FROM alertas WHERE id = $1', [id]);
  if (!existing.length) return res.status(404).json({ ok: false, error: 'Alerta no encontrada' });

  const alerta = existing[0];
  if (!tieneAccesoAAlerta(req, alerta)) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a esta alerta' });
  }

  const campos = [
    'nombre',
    'descripcion',
    'variable_key',
    'condicion',
    'umbral_bajo',
    'umbral_alto',
    'severidad',
    'cooldown_minutos',
    'dias_activos',
    'activa',
  ];
  const updates = [];
  const params = [];

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      params.push(
        campo === 'dias_activos' ? normalizarDiasActivos(req.body[campo]) : req.body[campo],
      );
      updates.push(`${campo} = $${params.length}`);
    }
  }
  if (!updates.length)
    return res.status(400).json({ ok: false, error: 'No hay campos para actualizar' });

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE alertas SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length} RETURNING *`,
    params,
  );

  res.json({ ok: true, data: rows[0] });
};

exports.eliminarAlerta = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM alertas WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Alerta no encontrada' });

  const alerta = rows[0];
  if (!tieneAccesoAAlerta(req, alerta)) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a esta alerta' });
  }

  await pool.query('DELETE FROM alertas WHERE id = $1', [id]);
  res.json({ ok: true, message: 'Alerta eliminada' });
};

exports.listarEventos = async (req, res) => {
  const {
    empresa_id,
    sitio_id,
    severidad,
    resuelta,
    desde,
    hasta,
    page = 1,
    limit = 50,
  } = req.query;

  const countParams = [];
  const conditions = [];

  if (req.user.tipo !== 'SuperAdmin') {
    countParams.push(req.user.empresa_id);
    conditions.push(`e.empresa_id = $${countParams.length}`);
  } else if (empresa_id) {
    countParams.push(empresa_id);
    conditions.push(`e.empresa_id = $${countParams.length}`);
  }

  if (req.user.sub_empresa_id) {
    countParams.push(req.user.sub_empresa_id);
    conditions.push(`e.sub_empresa_id = $${countParams.length}`);
  }

  if (sitio_id) {
    countParams.push(sitio_id);
    conditions.push(`e.sitio_id = $${countParams.length}`);
  }
  if (severidad) {
    countParams.push(severidad);
    conditions.push(`e.severidad = $${countParams.length}`);
  }
  if (resuelta !== undefined) {
    countParams.push(resuelta === 'true');
    conditions.push(`e.resuelta = $${countParams.length}`);
  }
  if (desde) {
    countParams.push(desde);
    conditions.push(`e.triggered_at >= $${countParams.length}`);
  }
  if (hasta) {
    countParams.push(hasta);
    conditions.push(`e.triggered_at <= $${countParams.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const limitPh = countParams.length + 1;
  const offsetPh = countParams.length + 2;
  const mainParams = [...countParams, parseInt(limit), offset];

  const { rows } = await pool.query(
    `SELECT e.*,
            a.nombre AS alerta_nombre,
            s.descripcion AS sitio_desc,
            emp.nombre AS empresa_nombre,
            FALSE AS leido
     FROM alertas_eventos e
     JOIN alertas a ON a.id = e.alerta_id
     LEFT JOIN sitio s ON s.id = e.sitio_id
     LEFT JOIN empresa emp ON emp.id = e.empresa_id
     ${where}
     ORDER BY e.triggered_at DESC
     LIMIT $${limitPh} OFFSET $${offsetPh}`,
    mainParams,
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM alertas_eventos e ${where}`,
    countParams,
  );

  res.json({
    ok: true,
    data: rows,
    total: parseInt(countRows[0].count),
    page: parseInt(page),
    limit: parseInt(limit),
  });
};

exports.obtenerEvento = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT e.*,
            a.nombre AS alerta_nombre, a.condicion, a.umbral_bajo, a.umbral_alto,
            s.descripcion AS sitio_desc, s.id_serial,
            emp.nombre AS empresa_nombre
     FROM alertas_eventos e
     JOIN alertas a ON a.id = e.alerta_id
     LEFT JOIN sitio s ON s.id = e.sitio_id
     LEFT JOIN empresa emp ON emp.id = e.empresa_id
     WHERE e.id = $1`,
    [id],
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Evento no encontrado' });

  const evento = rows[0];
  if (req.user.tipo !== 'SuperAdmin' && evento.empresa_id !== req.user.empresa_id) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
  }
  if (req.user.sub_empresa_id && evento.sub_empresa_id !== req.user.sub_empresa_id) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
  }

  res.json({ ok: true, data: evento });
};

exports.marcarLeido = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    'SELECT empresa_id, sub_empresa_id FROM alertas_eventos WHERE id = $1',
    [id],
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Evento no encontrado' });

  if (req.user.tipo !== 'SuperAdmin' && rows[0].empresa_id !== req.user.empresa_id) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
  }
  if (req.user.sub_empresa_id && rows[0].sub_empresa_id !== req.user.sub_empresa_id) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
  }

  res.json({ ok: true, message: 'Lectura de eventos no se registra en este modelo' });
};

exports.resolverEvento = async (req, res) => {
  const { id } = req.params;
  const { rows: existing } = await pool.query(
    'SELECT empresa_id, sub_empresa_id, resuelta FROM alertas_eventos WHERE id = $1',
    [id],
  );
  if (!existing.length) return res.status(404).json({ ok: false, error: 'Evento no encontrado' });

  const evento = existing[0];
  if (req.user.tipo !== 'SuperAdmin' && evento.empresa_id !== req.user.empresa_id) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
  }
  if (req.user.sub_empresa_id && evento.sub_empresa_id !== req.user.sub_empresa_id) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
  }
  if (evento.resuelta) {
    return res.status(400).json({ ok: false, error: 'El evento ya esta resuelto' });
  }

  const { rows } = await pool.query(
    `UPDATE alertas_eventos SET resuelta = TRUE, resuelta_at = NOW() WHERE id = $1 RETURNING *`,
    [id],
  );

  res.json({ ok: true, data: rows[0] });
};

exports.resumen = async (req, res) => {
  const esSuperAdmin = req.user.tipo === 'SuperAdmin';
  const params = [];
  const conditions = [];

  if (!esSuperAdmin) {
    params.push(req.user.empresa_id);
    conditions.push(`empresa_id = $${params.length}`);
  }

  if (req.user.sub_empresa_id) {
    params.push(req.user.sub_empresa_id);
    conditions.push(`sub_empresa_id = $${params.length}`);
  }

  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE resuelta = FALSE) AS activas,
       COUNT(*) FILTER (WHERE resuelta = FALSE AND severidad = 'critica') AS criticas,
       COUNT(*) FILTER (WHERE resuelta = FALSE AND severidad = 'alta')    AS altas,
       COUNT(*) FILTER (WHERE resuelta = FALSE AND severidad = 'media')   AS medias,
       COUNT(*) FILTER (WHERE resuelta = FALSE AND severidad = 'baja')    AS bajas
     FROM alertas_eventos
     WHERE 1=1 ${where}`,
    params,
  );

  res.json({
    ok: true,
    data: { ...rows[0], no_leidas: 0 },
  });
};
