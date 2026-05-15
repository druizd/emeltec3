const pool = require('../config/db');
const blob = require('../services/azureBlobService');

const TIPOS = ['ficha_tecnica', 'datasheet', 'certificado', 'manual', 'plano', 'otro'];

const MIME_WHITELIST = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/csv',
  'text/plain',
]);

function esSuperAdmin(req) {
  return req.user?.tipo === 'SuperAdmin';
}

function tieneAcceso(req, doc) {
  if (esSuperAdmin(req)) return true;
  if (doc.empresa_id !== req.user.empresa_id) return false;
  if (req.user.sub_empresa_id && doc.sub_empresa_id !== req.user.sub_empresa_id) return false;
  return true;
}

const SELECT_FIELDS = `
  d.id, d.sitio_id, d.empresa_id, d.sub_empresa_id, d.titulo, d.tipo, d.descripcion,
  d.blob_path, d.nombre_original, d.mime, d.size_bytes,
  d.version, d.fecha_vigencia, d.uploaded_by, d.created_at, d.updated_at,
  s.descripcion AS sitio_desc,
  u.nombre  AS uploader_nombre,
  u.apellido AS uploader_apellido
`;

const JOIN_CLAUSE = `
  FROM documentos d
  LEFT JOIN sitio   s ON s.id = d.sitio_id
  LEFT JOIN usuario u ON u.id = d.uploaded_by
`;

function enrich(row) {
  return {
    ...row,
    uploader_nombre_completo: row.uploader_nombre
      ? `${row.uploader_nombre} ${row.uploader_apellido || ''}`.trim()
      : null,
  };
}

exports.listarDocumentos = async (req, res) => {
  const { sitio_id, empresa_id, tipo, page = 1, limit = 100 } = req.query;
  const params = [];
  const conditions = [];

  if (!esSuperAdmin(req)) {
    params.push(req.user.empresa_id);
    conditions.push(`d.empresa_id = $${params.length}`);
    if (req.user.sub_empresa_id) {
      params.push(req.user.sub_empresa_id);
      conditions.push(`d.sub_empresa_id = $${params.length}`);
    }
  } else if (empresa_id) {
    params.push(empresa_id);
    conditions.push(`d.empresa_id = $${params.length}`);
  }

  if (sitio_id) {
    params.push(sitio_id);
    conditions.push(`d.sitio_id = $${params.length}`);
  }
  if (tipo) {
    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ ok: false, error: 'tipo inválido' });
    }
    params.push(tipo);
    conditions.push(`d.tipo = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const limitPh = params.length + 1;
  const offsetPh = params.length + 2;

  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS}
       ${JOIN_CLAUSE}
       ${where}
       ORDER BY d.created_at DESC
       LIMIT $${limitPh} OFFSET $${offsetPh}`,
    [...params, parseInt(limit, 10), offset],
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM documentos d ${where}`,
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

exports.obtenerDocumento = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(`SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE} WHERE d.id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
  if (!tieneAcceso(req, rows[0])) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este documento' });
  }
  res.json({ ok: true, data: enrich(rows[0]) });
};

exports.subirDocumento = async (req, res) => {
  if (!blob.ensureConfigured(res)) return;

  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'Falta archivo (campo "file")' });
  }

  const {
    sitio_id,
    empresa_id,
    titulo,
    tipo = 'otro',
    descripcion = null,
    version = '1.0',
    fecha_vigencia = null,
  } = req.body;

  if (!sitio_id || !empresa_id || !titulo) {
    return res
      .status(400)
      .json({ ok: false, error: 'Campos requeridos: sitio_id, empresa_id, titulo' });
  }

  if (!TIPOS.includes(tipo)) {
    return res.status(400).json({ ok: false, error: 'tipo inválido' });
  }

  if (!MIME_WHITELIST.has(req.file.mimetype)) {
    return res.status(415).json({ ok: false, error: `MIME no permitido: ${req.file.mimetype}` });
  }

  if (!esSuperAdmin(req) && empresa_id !== req.user.empresa_id) {
    return res.status(403).json({ ok: false, error: 'No puedes subir documentos a otra empresa' });
  }

  const blobPath = blob.buildBlobPath(sitio_id, req.file.originalname);
  const sub_empresa_id = req.user.sub_empresa_id ?? null;

  try {
    await blob.uploadBuffer({
      blobPath,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });
  } catch (err) {
    console.error('[documentos] Error upload Azure:', err.message);
    return res.status(502).json({ ok: false, error: 'Error subiendo a Azure Blob' });
  }

  let inserted;
  try {
    const { rows } = await pool.query(
      `INSERT INTO documentos
         (sitio_id, empresa_id, sub_empresa_id, titulo, tipo, descripcion,
          blob_path, nombre_original, mime, size_bytes, version, fecha_vigencia, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        sitio_id,
        empresa_id,
        sub_empresa_id,
        titulo,
        tipo,
        descripcion,
        blobPath,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        version,
        fecha_vigencia || null,
        req.user.id,
      ],
    );
    inserted = rows[0];
  } catch (err) {
    // Rollback Azure si falla DB.
    await blob.deleteBlob(blobPath).catch(() => {});
    console.error('[documentos] Error insert DB:', err.message);
    return res.status(500).json({ ok: false, error: 'Error guardando metadata' });
  }

  const { rows: full } = await pool.query(
    `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE} WHERE d.id = $1`,
    [inserted.id],
  );
  res.status(201).json({ ok: true, data: enrich(full[0]) });
};

exports.descargarDocumento = async (req, res) => {
  if (!blob.ensureConfigured(res)) return;

  const { id } = req.params;
  const { rows } = await pool.query(`SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE} WHERE d.id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
  const doc = rows[0];
  if (!tieneAcceso(req, doc)) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este documento' });
  }

  try {
    const url = blob.generateDownloadSasUrl(doc.blob_path, doc.nombre_original);
    res.json({ ok: true, data: { url, expires_in_min: 15 } });
  } catch (err) {
    console.error('[documentos] Error generando SAS:', err.message);
    res.status(500).json({ ok: false, error: 'No se pudo generar URL de descarga' });
  }
};

exports.actualizarDocumento = async (req, res) => {
  const { id } = req.params;
  const { rows: existing } = await pool.query('SELECT * FROM documentos WHERE id = $1', [id]);
  if (!existing.length)
    return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
  if (!tieneAcceso(req, existing[0])) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este documento' });
  }

  const campos = ['titulo', 'tipo', 'descripcion', 'version', 'fecha_vigencia'];
  const updates = [];
  const params = [];
  for (const campo of campos) {
    if (req.body[campo] === undefined) continue;
    if (campo === 'tipo' && !TIPOS.includes(req.body[campo])) {
      return res.status(400).json({ ok: false, error: 'tipo inválido' });
    }
    params.push(req.body[campo]);
    updates.push(`${campo} = $${params.length}`);
  }

  if (!updates.length) {
    return res.status(400).json({ ok: false, error: 'Sin campos para actualizar' });
  }

  params.push(id);
  await pool.query(
    `UPDATE documentos SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params,
  );

  const { rows: full } = await pool.query(
    `SELECT ${SELECT_FIELDS} ${JOIN_CLAUSE} WHERE d.id = $1`,
    [id],
  );
  res.json({ ok: true, data: enrich(full[0]) });
};

exports.eliminarDocumento = async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM documentos WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
  if (!tieneAcceso(req, rows[0])) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a este documento' });
  }

  const doc = rows[0];
  // Borra metadata primero. Si falla Azure, el blob queda huérfano (limpieza
  // posterior con un job) — mejor que dejar metadata sin blob accesible.
  await pool.query('DELETE FROM documentos WHERE id = $1', [id]);
  blob.deleteBlob(doc.blob_path).catch((err) => {
    console.warn('[documentos] No se pudo borrar blob huérfano:', doc.blob_path, err.message);
  });

  res.json({ ok: true, message: 'Documento eliminado' });
};
