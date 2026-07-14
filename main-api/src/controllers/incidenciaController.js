const pool = require('../config/db');
const { userCanAccessSiteId } = require('../services/dataAccess');

const ORIGENES = ['terreno', 'remota'];
const CATEGORIAS = ['sensor', 'comunicacion', 'mecanico', 'electrico', 'otro'];
const GRAVEDADES = ['leve', 'media', 'critica'];
const ESTADOS = ['abierta', 'en_progreso', 'resuelta', 'cerrada'];

function esSuperAdmin(req) {
  return req.user?.tipo === 'SuperAdmin';
}

function tieneAcceso(req, incidencia) {
  if (esSuperAdmin(req)) return true;
  if (incidencia.empresa_id !== req.user.empresa_id) return false;
  if (req.user.sub_empresa_id && incidencia.sub_empresa_id !== req.user.sub_empresa_id)
    return false;
  return true;
}

const SELECT_FIELDS = `
  i.id, i.sitio_id, i.empresa_id, i.sub_empresa_id,
  i.titulo, i.descripcion, i.origen, i.categoria, i.gravedad, i.estado,
  i.tecnico_id, i.alerta_evento_id, i.creado_por,
  i.created_at, i.updated_at, i.cerrado_at,
  s.descripcion AS sitio_desc,
  e.nombre      AS empresa_nombre,
  ut.nombre     AS tecnico_nombre,
  ut.apellido   AS tecnico_apellido,
  uc.nombre     AS creador_nombre,
  uc.apellido   AS creador_apellido,
  tec.tecnicos
`;

const JOIN_CLAUSE = `
  FROM incidencias i
  LEFT JOIN sitio   s  ON s.id  = i.sitio_id
  LEFT JOIN empresa e  ON e.id  = i.empresa_id
  LEFT JOIN usuario ut ON ut.id = i.tecnico_id
  LEFT JOIN usuario uc ON uc.id = i.creado_por
  LEFT JOIN LATERAL (
    SELECT COALESCE(
             json_agg(
               json_build_object(
                 'id', u.id,
                 'nombre', u.nombre,
                 'apellido', COALESCE(u.apellido, '')
               ) ORDER BY u.nombre
             ),
             '[]'::json
           ) AS tecnicos
      FROM incidencia_tecnicos it
      JOIN usuario u ON u.id = it.usuario_id
     WHERE it.incidencia_id = i.id
  ) tec ON true
`;

/**
 * Valida el array tecnico_ids: strings únicos, máx 10, y TODOS usuarios
 * activos del equipo Emeltec (tipo SuperAdmin). Devuelve array normalizado
 * o lanza objeto {status, error} para responder.
 */
async function validarTecnicoIds(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string' || !t.trim())) {
    throw { status: 400, error: 'tecnico_ids debe ser un array de ids de usuario' };
  }
  const ids = [...new Set(raw.map((t) => t.trim()))];
  if (ids.length > 10) {
    throw { status: 400, error: 'Máximo 10 técnicos por incidencia' };
  }
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM usuario
      WHERE id = ANY($1) AND tipo = 'SuperAdmin' AND COALESCE(activo, true) = true`,
    [ids],
  );
  if (rows[0].n !== ids.length) {
    throw {
      status: 400,
      error: 'Todos los técnicos deben ser usuarios activos del equipo Emeltec',
    };
  }
  return ids;
}

/** Reemplaza las asignaciones de la incidencia (dentro de la tx del caller). */
async function reemplazarTecnicos(client, incidenciaId, tecnicoIds) {
  await client.query('DELETE FROM incidencia_tecnicos WHERE incidencia_id = $1', [incidenciaId]);
  for (const uid of tecnicoIds) {
    await client.query(
      'INSERT INTO incidencia_tecnicos (incidencia_id, usuario_id) VALUES ($1, $2)',
      [incidenciaId, uid],
    );
  }
}

exports.listarIncidencias = async (req, res) => {
  const {
    sitio_id,
    empresa_id,
    estado,
    origen,
    categoria,
    gravedad,
    alerta_evento_id,
    desde,
    hasta,
    page = 1,
    limit = 50,
  } = req.query;

  const params = [];
  const conditions = [];

  if (!esSuperAdmin(req)) {
    params.push(req.user.empresa_id);
    conditions.push(`i.empresa_id = $${params.length}`);
    if (req.user.sub_empresa_id) {
      params.push(req.user.sub_empresa_id);
      conditions.push(`i.sub_empresa_id = $${params.length}`);
    }
  } else if (empresa_id) {
    params.push(empresa_id);
    conditions.push(`i.empresa_id = $${params.length}`);
  }

  if (sitio_id) {
    params.push(sitio_id);
    conditions.push(`i.sitio_id = $${params.length}`);
  }
  if (estado) {
    params.push(estado);
    conditions.push(`i.estado = $${params.length}`);
  }
  if (origen) {
    params.push(origen);
    conditions.push(`i.origen = $${params.length}`);
  }
  if (categoria) {
    params.push(categoria);
    conditions.push(`i.categoria = $${params.length}`);
  }
  if (gravedad) {
    params.push(gravedad);
    conditions.push(`i.gravedad = $${params.length}`);
  }
  if (alerta_evento_id) {
    params.push(parseInt(alerta_evento_id, 10));
    conditions.push(`i.alerta_evento_id = $${params.length}`);
  }
  if (desde) {
    params.push(desde);
    conditions.push(`i.created_at >= $${params.length}`);
  }
  if (hasta) {
    params.push(hasta);
    conditions.push(`i.created_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const limitPh = params.length + 1;
  const offsetPh = params.length + 2;
  const listParams = [...params, parseInt(limit, 10), offset];

  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS}
       ${JOIN_CLAUSE}
       ${where}
       ORDER BY i.created_at DESC
       LIMIT $${limitPh} OFFSET $${offsetPh}`,
    listParams,
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM incidencias i ${where}`,
    params,
  );

  res.json({
    ok: true,
    data: rows.map(enrich),
    total: parseInt(countRows[0].count, 10),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  });
};

exports.obtenerIncidencia = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(`SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE} WHERE i.id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Incidencia no encontrada' });
  const inc = rows[0];
  if (!tieneAcceso(req, inc)) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a esta incidencia' });
  }
  res.json({ ok: true, data: enrich(inc) });
};

exports.crearIncidencia = async (req, res) => {
  const {
    sitio_id,
    empresa_id,
    titulo,
    descripcion,
    origen = 'remota',
    categoria = 'otro',
    gravedad = 'media',
    estado = 'abierta',
    tecnico_id = null,
    tecnico_ids = undefined,
    alerta_evento_id = null,
  } = req.body;

  // Multi-técnico: tecnico_ids manda; tecnico_id (legacy) se acepta como
  // array de uno. La columna única se dual-escribe con el primero.
  let tecnicosNorm;
  try {
    tecnicosNorm = await validarTecnicoIds(
      tecnico_ids !== undefined ? tecnico_ids : tecnico_id ? [tecnico_id] : [],
    );
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ ok: false, error: e.error });
    throw e;
  }

  if (!sitio_id || !empresa_id || !titulo) {
    return res
      .status(400)
      .json({ ok: false, error: 'Campos requeridos: sitio_id, empresa_id, titulo' });
  }

  if (String(titulo).length > 255 || (descripcion != null && String(descripcion).length > 2000)) {
    return res.status(400).json({
      ok: false,
      error: 'titulo (máx 255) o descripcion (máx 2000) exceden el largo permitido',
    });
  }

  if (
    !ORIGENES.includes(origen) ||
    !CATEGORIAS.includes(categoria) ||
    !GRAVEDADES.includes(gravedad) ||
    !ESTADOS.includes(estado)
  ) {
    return res
      .status(400)
      .json({ ok: false, error: 'Valor inválido en origen/categoria/gravedad/estado' });
  }

  if (!esSuperAdmin(req) && empresa_id !== req.user.empresa_id) {
    return res
      .status(403)
      .json({ ok: false, error: 'No puedes crear incidencias en otra empresa' });
  }

  if (!(await userCanAccessSiteId(pool, req.user, sitio_id))) {
    return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
  }

  const sub_empresa_id = req.user.sub_empresa_id ?? null;

  // Si vincula un evento de alerta, escribe también el incidencia_id (texto) en alertas_eventos
  // para mantener consistencia con la columna existente.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO incidencias
         (sitio_id, empresa_id, sub_empresa_id, titulo, descripcion,
          origen, categoria, gravedad, estado, tecnico_id, alerta_evento_id, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        sitio_id,
        empresa_id,
        sub_empresa_id,
        titulo,
        descripcion ?? null,
        origen,
        categoria,
        gravedad,
        estado,
        tecnicosNorm[0] ?? null,
        alerta_evento_id,
        req.user.id,
      ],
    );

    const incId = rows[0].id;

    if (tecnicosNorm.length > 0) {
      await reemplazarTecnicos(client, incId, tecnicosNorm);
    }

    if (alerta_evento_id) {
      await client.query(
        `UPDATE alertas_eventos
            SET incidencia_id = $2
          WHERE id = $1 AND incidencia_id IS NULL`,
        [alerta_evento_id, `INC-${String(incId).padStart(4, '0')}`],
      );
    }

    await client.query('COMMIT');

    const { rows: full } = await pool.query(
      `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE} WHERE i.id = $1`,
      [incId],
    );
    return res.status(201).json({ ok: true, data: enrich(full[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[incidencias] Error creando:', err.message);
    return res.status(500).json({ ok: false, error: 'Error creando incidencia' });
  } finally {
    client.release();
  }
};

exports.actualizarIncidencia = async (req, res) => {
  const { id } = req.params;
  const { rows: existing } = await pool.query('SELECT * FROM incidencias WHERE id = $1', [id]);
  if (!existing.length)
    return res.status(404).json({ ok: false, error: 'Incidencia no encontrada' });

  if (!tieneAcceso(req, existing[0])) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a esta incidencia' });
  }

  const campos = [
    'titulo',
    'descripcion',
    'origen',
    'categoria',
    'gravedad',
    'estado',
    'tecnico_id',
    'alerta_evento_id',
  ];

  const validators = {
    origen: (v) => ORIGENES.includes(v),
    categoria: (v) => CATEGORIAS.includes(v),
    gravedad: (v) => GRAVEDADES.includes(v),
    estado: (v) => ESTADOS.includes(v),
    titulo: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 255,
    descripcion: (v) => v == null || (typeof v === 'string' && v.length <= 2000),
  };

  const updates = [];
  const params = [];
  for (const campo of campos) {
    if (req.body[campo] === undefined) continue;
    const v = req.body[campo];
    if (validators[campo] && !validators[campo](v)) {
      return res.status(400).json({ ok: false, error: `Valor inválido para ${campo}` });
    }
    params.push(v);
    updates.push(`${campo} = $${params.length}`);
  }

  // Multi-técnico: reemplaza el set completo + dual-write de tecnico_id.
  let tecnicosNorm = null;
  if (req.body.tecnico_ids !== undefined) {
    try {
      tecnicosNorm = await validarTecnicoIds(req.body.tecnico_ids);
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ ok: false, error: e.error });
      throw e;
    }
    params.push(tecnicosNorm[0] ?? null);
    updates.push(`tecnico_id = $${params.length}`);
  }

  if (!updates.length) {
    return res.status(400).json({ ok: false, error: 'Sin campos para actualizar' });
  }

  // Si el estado pasa a 'cerrada' o 'resuelta', setear cerrado_at si aún no estaba.
  const newEstado = req.body.estado;
  if (newEstado === 'cerrada' || newEstado === 'resuelta') {
    updates.push(`cerrado_at = COALESCE(cerrado_at, NOW())`);
  } else if (newEstado === 'abierta' || newEstado === 'en_progreso') {
    updates.push(`cerrado_at = NULL`);
  }

  params.push(id);
  const client = await pool.connect();
  let updatedId;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE incidencias SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING id`,
      params,
    );
    updatedId = rows[0].id;
    if (tecnicosNorm !== null) {
      await reemplazarTecnicos(client, updatedId, tecnicosNorm);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[incidencias] Error actualizando:', err.message);
    return res.status(500).json({ ok: false, error: 'Error actualizando incidencia' });
  } finally {
    client.release();
  }

  const { rows: full } = await pool.query(
    `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE} WHERE i.id = $1`,
    [updatedId],
  );
  res.json({ ok: true, data: enrich(full[0]) });
};

exports.eliminarIncidencia = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM incidencias WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Incidencia no encontrada' });
  if (!tieneAcceso(req, rows[0])) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a esta incidencia' });
  }
  await pool.query('DELETE FROM incidencias WHERE id = $1', [id]);
  res.json({ ok: true, message: 'Incidencia eliminada' });
};

function enrich(row) {
  const tecnicos = Array.isArray(row.tecnicos) ? row.tecnicos : [];
  const nombres = tecnicos.map((t) => `${t.nombre} ${t.apellido || ''}`.trim());
  return {
    ...row,
    tecnicos,
    codigo: `INC-${String(row.id).padStart(4, '0')}`,
    // Compat: si hay array úsalo (todos los nombres); si no, cae al legacy.
    tecnico_nombre_completo: nombres.length
      ? nombres.join(', ')
      : row.tecnico_nombre
        ? `${row.tecnico_nombre} ${row.tecnico_apellido || ''}`.trim()
        : null,
    creador_nombre_completo: row.creador_nombre
      ? `${row.creador_nombre} ${row.creador_apellido || ''}`.trim()
      : null,
  };
}
