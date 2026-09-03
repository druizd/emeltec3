const pool = require('../config/db');
const {
  canAccessSite,
  buildUserSiteScope,
  userCanAccessSiteId,
} = require('../services/dataAccess');
// Misma matemática que el dashboard y que el worker de alertas: el tester
// muestra el valor transformado por el reg_map, que es contra el que se
// compara el umbral.
const { applyMappingTransform, normalizeTransform } = require('../utils/mappingTransform.js');

const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

/**
 * Normaliza y valida los destinatarios de una regla.
 *
 * `notificar_user_ids` tiene que apuntar a usuarios existentes, activos y de la
 * MISMA empresa que la alerta: es la única barrera contra mandar el correo de
 * un pozo de una empresa a alguien de otra. Los SuperAdmin no van en la lista,
 * los cubre `notificar_superadmins`.
 *
 * Devuelve `{ ids, superadmins }` con `undefined` en lo que el body no trae
 * (para que el PATCH no pise lo que no se mandó), o `{ error }`.
 */
async function normalizarDestinatarios(body, empresaId) {
  let ids;
  if (body.notificar_user_ids !== undefined) {
    if (!Array.isArray(body.notificar_user_ids)) {
      return { error: 'notificar_user_ids debe ser una lista de ids de usuario.' };
    }
    ids = [
      ...new Set(
        body.notificar_user_ids.filter(
          (s) => typeof s === 'string' && s.length > 0 && s.length <= 10,
        ),
      ),
    ];
    if (ids.length) {
      const { rows } = await pool.query(
        `SELECT id FROM usuario
          WHERE id = ANY($1::text[])
            AND COALESCE(activo, TRUE)
            AND empresa_id = $2
            AND tipo <> 'SuperAdmin'`,
        [ids, empresaId],
      );
      if (rows.length !== ids.length) {
        return {
          error:
            'Hay destinatarios que no existen, están inactivos o no pertenecen a la empresa de la alerta.',
        };
      }
    }
  }

  let superadmins;
  if (body.notificar_superadmins !== undefined) {
    superadmins = body.notificar_superadmins === true || body.notificar_superadmins === 'true';
  }

  return { ids, superadmins };
}

function normalizarDiasActivos(dias) {
  if (!Array.isArray(dias) || dias.length === 0) return DIAS_VALIDOS;
  return [...new Set(dias.map((d) => String(d).toLowerCase().trim()))].filter((d) =>
    DIAS_VALIDOS.includes(d),
  );
}

function esSuperAdmin(req) {
  return req.user?.tipo === 'SuperAdmin';
}

/**
 * Roles que administran alarmas (mismos que alertaRoutes permite para
 * crear/editar/borrar). Ven todas las reglas dentro de su alcance: no se puede
 * gestionar una regla que no se ve.
 */
const ROLES_EDITORES_ALARMA = new Set(['SuperAdmin', 'Admin', 'Gerente', 'Vendedor']);

/**
 * Filtro de visibilidad de una regla (`alertas.visible_to_all` /
 * `viewer_user_ids`). Estos campos se guardaban desde el formulario pero NO se
 * aplicaban en ninguna consulta: una regla marcada "Restringida" la veía todo
 * el mundo igual.
 *
 * Se aplica solo a los roles NO editores (típicamente Cliente): restringir
 * sirve para acotar el ruido a quien opera, no para esconderle reglas a quien
 * las administra.
 *
 * @param {object} user
 * @param {string} alias alias de la tabla `alertas` en la query
 * @param {number} startIndex índice del primer placeholder disponible
 */
function buildAlarmVisibilityScope(user, alias = 'a', startIndex = 1) {
  if (!user || ROLES_EDITORES_ALARMA.has(user.tipo)) {
    return { clause: '', params: [] };
  }
  return {
    clause:
      `(${alias}.visible_to_all = TRUE` +
      ` OR ${alias}.creado_por = $${startIndex}` +
      ` OR $${startIndex} = ANY(${alias}.viewer_user_ids))`,
    params: [user.id],
  };
}

// Exportado para tests.
exports.buildAlarmVisibilityScope = buildAlarmVisibilityScope;

// Modelo unificado por empresa/sub-empresa (canAccessSite), no por creador.
// Antes un usuario no podía gestionar alertas de un colega de su misma empresa,
// y el control no respetaba el límite de sub-empresa.
function tieneAccesoAAlerta(req, alerta) {
  return canAccessSite(req.user, alerta);
}

function deriveEstado(evento) {
  if (evento.resuelta) return 'resuelta';
  if (evento.asignado_a) return 'asignada';
  if (evento.reconocida_at) return 'reconocida';
  return 'activa';
}

async function loadEventoOr404(req, res) {
  const { id } = req.params;
  const { rows } = await pool.query(
    'SELECT id, empresa_id, sub_empresa_id, resuelta, reconocida_at FROM alertas_eventos WHERE id = $1',
    [id],
  );
  if (!rows.length) {
    res.status(404).json({ ok: false, error: 'Evento no encontrado' });
    return null;
  }
  const evento = rows[0];
  if (req.user.tipo !== 'SuperAdmin' && evento.empresa_id !== req.user.empresa_id) {
    res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
    return null;
  }
  if (req.user.sub_empresa_id && evento.sub_empresa_id !== req.user.sub_empresa_id) {
    res.status(403).json({ ok: false, error: 'Sin acceso a este evento' });
    return null;
  }
  return evento;
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
    visible_to_all,
    viewer_user_ids,
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

  // El sitio destino debe pertenecer al alcance del usuario (no solo la empresa).
  if (!(await userCanAccessSiteId(pool, req.user, sitio_id))) {
    return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
  }

  const sub_empresa_id = req.user.sub_empresa_id ?? null;
  const diasActivos = normalizarDiasActivos(dias_activos);
  if (!diasActivos.length) {
    return res
      .status(400)
      .json({ ok: false, error: 'Debe seleccionar al menos un dia activo valido' });
  }

  const visibleToAll = visible_to_all !== false;
  const viewerIds = Array.isArray(viewer_user_ids)
    ? viewer_user_ids.filter((s) => typeof s === 'string' && s.length > 0)
    : [];

  const destinatarios = await normalizarDestinatarios(req.body, empresa_id);
  if (destinatarios.error) {
    return res.status(400).json({ ok: false, error: destinatarios.error });
  }

  const { rows } = await pool.query(
    `INSERT INTO alertas
       (nombre, descripcion, sitio_id, empresa_id, sub_empresa_id, variable_key,
        condicion, umbral_bajo, umbral_alto, severidad, cooldown_minutos, dias_activos, creado_por,
        visible_to_all, viewer_user_ids, notificar_user_ids, notificar_superadmins)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      visibleToAll,
      visibleToAll ? [] : viewerIds,
      destinatarios.ids ?? [],
      destinatarios.superadmins ?? true,
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
    // Alcance por empresa/sub-empresa del usuario (antes filtraba por creador).
    const scope = buildUserSiteScope(req.user, 'a', params.length + 1);
    conditions.push(scope.clause || 'FALSE');
    params.push(...scope.params);
  }

  if (sitio_id) {
    params.push(sitio_id);
    conditions.push(`a.sitio_id = $${params.length}`);
  }
  if (activa !== undefined) {
    params.push(activa === 'true');
    conditions.push(`a.activa = $${params.length}`);
  }

  const visibilidad = buildAlarmVisibilityScope(req.user, 'a', params.length + 1);
  if (visibilidad.clause) {
    conditions.push(visibilidad.clause);
    params.push(...visibilidad.params);
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
    'visible_to_all',
    'viewer_user_ids',
    'notificar_user_ids',
    'notificar_superadmins',
  ];
  const updates = [];
  const params = [];

  // Los destinatarios se validan contra la empresa de la alerta guardada, no
  // contra la del body: el PATCH no puede mover una regla de empresa.
  const destinatarios = await normalizarDestinatarios(req.body, alerta.empresa_id);
  if (destinatarios.error) {
    return res.status(400).json({ ok: false, error: destinatarios.error });
  }
  const normalizados = {
    dias_activos: (v) => normalizarDiasActivos(v),
    notificar_user_ids: () => destinatarios.ids,
    notificar_superadmins: () => destinatarios.superadmins,
  };

  for (const campo of campos) {
    if (req.body[campo] !== undefined) {
      params.push(normalizados[campo] ? normalizados[campo](req.body[campo]) : req.body[campo]);
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

  // Alcance por sitio, con el MISMO criterio que listarAlertas. Antes se
  // filtraba a mano por empresa_id/sub_empresa_id, lo que para un Vendedor
  // daba un conjunto distinto al de las reglas: le mostraba sitios de su
  // empresa que no tiene asignados y le ocultaba las maletas piloto de otras.
  if (esSuperAdmin(req)) {
    if (empresa_id) {
      countParams.push(empresa_id);
      conditions.push(`e.empresa_id = $${countParams.length}`);
    }
  } else {
    const scope = buildUserSiteScope(req.user, 's', countParams.length + 1);
    conditions.push(scope.clause || 'FALSE');
    countParams.push(...scope.params);
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

  const visibilidad = buildAlarmVisibilityScope(req.user, 'a', countParams.length + 1);
  if (visibilidad.clause) {
    conditions.push(visibilidad.clause);
    countParams.push(...visibilidad.params);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // El WHERE referencia `a` (visibilidad) y `s` (alcance), así que el COUNT
  // necesita los mismos JOINs que la consulta principal.
  const eventosFrom = `
    FROM alertas_eventos e
    JOIN alertas a ON a.id = e.alerta_id
    LEFT JOIN sitio s ON s.id = e.sitio_id`;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const limitPh = countParams.length + 1;
  const offsetPh = countParams.length + 2;
  const mainParams = [...countParams, parseInt(limit), offset];

  const { rows } = await pool.query(
    `SELECT e.*,
            a.nombre AS alerta_nombre,
            a.condicion,
            s.descripcion AS sitio_desc,
            s.id_serial,
            emp.nombre AS empresa_nombre,
            ua.nombre  AS asignado_nombre,
            ua.apellido AS asignado_apellido,
            ur.nombre  AS reconocido_nombre,
            ur.apellido AS reconocido_apellido,
            FALSE AS leido
     ${eventosFrom}
     LEFT JOIN empresa emp ON emp.id = e.empresa_id
     LEFT JOIN usuario ua ON ua.id = e.asignado_a
     LEFT JOIN usuario ur ON ur.id = e.reconocida_por
     ${where}
     ORDER BY e.triggered_at DESC
     LIMIT $${limitPh} OFFSET $${offsetPh}`,
    mainParams,
  );

  const enriched = rows.map((r) => ({
    ...r,
    estado: deriveEstado(r),
    asignado_nombre_completo: r.asignado_nombre
      ? `${r.asignado_nombre} ${r.asignado_apellido || ''}`.trim()
      : null,
  }));

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) ${eventosFrom} ${where}`,
    countParams,
  );

  res.json({
    ok: true,
    data: enriched,
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

  res.json({ ok: true, data: { ...rows[0], estado: deriveEstado(rows[0]) } });
};

exports.reconocerEvento = async (req, res) => {
  const evento = await loadEventoOr404(req, res);
  if (!evento) return;
  if (evento.resuelta) {
    return res.status(400).json({ ok: false, error: 'El evento ya está resuelto' });
  }
  if (evento.reconocida_at) {
    return res.status(400).json({ ok: false, error: 'El evento ya fue reconocido' });
  }
  const { rows } = await pool.query(
    `UPDATE alertas_eventos
        SET reconocida_at = NOW(), reconocida_por = $2
      WHERE id = $1 RETURNING *`,
    [req.params.id, req.user.id],
  );
  res.json({ ok: true, data: { ...rows[0], estado: deriveEstado(rows[0]) } });
};

exports.asignarEvento = async (req, res) => {
  const evento = await loadEventoOr404(req, res);
  if (!evento) return;
  if (evento.resuelta) {
    return res.status(400).json({ ok: false, error: 'El evento ya está resuelto' });
  }
  const { asignado_a } = req.body;
  if (!asignado_a) {
    return res.status(400).json({ ok: false, error: 'Falta asignado_a (id de usuario)' });
  }
  const { rows: usuarios } = await pool.query('SELECT id FROM usuario WHERE id = $1', [asignado_a]);
  if (!usuarios.length) {
    return res.status(400).json({ ok: false, error: 'Usuario asignado no existe' });
  }
  const { rows } = await pool.query(
    `UPDATE alertas_eventos
        SET asignado_a = $2,
            asignado_at = NOW(),
            reconocida_at = COALESCE(reconocida_at, NOW()),
            reconocida_por = COALESCE(reconocida_por, $3)
      WHERE id = $1 RETURNING *`,
    [req.params.id, asignado_a, req.user.id],
  );
  res.json({ ok: true, data: { ...rows[0], estado: deriveEstado(rows[0]) } });
};

exports.vincularIncidencia = async (req, res) => {
  const evento = await loadEventoOr404(req, res);
  if (!evento) return;
  const { incidencia_id } = req.body;
  if (!incidencia_id || !String(incidencia_id).trim()) {
    return res.status(400).json({ ok: false, error: 'Falta incidencia_id' });
  }
  const incId = String(incidencia_id).trim();
  // La incidencia a vincular debe pertenecer al alcance del usuario (antes se
  // aceptaba cualquier incidencia_id del body sin verificar propiedad).
  const { rows: incRows } = await pool.query(
    'SELECT empresa_id, sub_empresa_id FROM incidencias WHERE id = $1',
    [incId],
  );
  if (!incRows.length || !canAccessSite(req.user, incRows[0])) {
    return res.status(403).json({ ok: false, error: 'Sin acceso a esa incidencia' });
  }
  const { rows } = await pool.query(
    `UPDATE alertas_eventos SET incidencia_id = $2 WHERE id = $1 RETURNING *`,
    [req.params.id, incId],
  );
  res.json({ ok: true, data: { ...rows[0], estado: deriveEstado(rows[0]) } });
};

exports.resumen = async (req, res) => {
  const { sitio_id, empresa_id } = req.query;
  const params = [];
  const conditions = [];

  // Mismo criterio de alcance y visibilidad que listarAlertas/listarEventos:
  // la campana del header no puede contar eventos que el usuario no vería al
  // abrir la bandeja.
  if (esSuperAdmin(req)) {
    if (empresa_id) {
      params.push(empresa_id);
      conditions.push(`e.empresa_id = $${params.length}`);
    }
  } else {
    const scope = buildUserSiteScope(req.user, 's', params.length + 1);
    conditions.push(scope.clause || 'FALSE');
    params.push(...scope.params);
  }

  if (sitio_id) {
    params.push(sitio_id);
    conditions.push(`e.sitio_id = $${params.length}`);
  }

  const visibilidad = buildAlarmVisibilityScope(req.user, 'a', params.length + 1);
  if (visibilidad.clause) {
    conditions.push(visibilidad.clause);
    params.push(...visibilidad.params);
  }

  const from = `
    FROM alertas_eventos e
    JOIN alertas a ON a.id = e.alerta_id
    LEFT JOIN sitio s ON s.id = e.sitio_id`;
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // "Sin revisar" = no resuelta y que nadie haya reconocido todavía. Es el
  // contador que alimenta la campana del header: lo que aún no ha tocado
  // ningún operador. No existe un "leído" por usuario — `marcarLeido` es un
  // no-op y este modelo trata la bandeja como estado de equipo, no personal.
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE e.resuelta = FALSE) AS activas,
       COUNT(*) FILTER (WHERE e.resuelta = FALSE AND e.reconocida_at IS NULL) AS sin_revisar,
       COUNT(*) FILTER (WHERE e.resuelta = FALSE AND e.severidad = 'critica') AS criticas,
       COUNT(*) FILTER (WHERE e.resuelta = FALSE AND e.severidad = 'alta')    AS altas,
       COUNT(*) FILTER (WHERE e.resuelta = FALSE AND e.severidad = 'media')   AS medias,
       COUNT(*) FILTER (WHERE e.resuelta = FALSE AND e.severidad = 'baja')    AS bajas
     ${from}
     ${where}`,
    params,
  );

  // Los más recientes sin revisar, para que el header pueda listarlos y
  // disparar el popup sin un segundo round-trip por cada poll.
  const pendientes = 'e.resuelta = FALSE AND e.reconocida_at IS NULL';
  const { rows: recientes } = await pool.query(
    `SELECT e.id, e.severidad, e.mensaje, e.triggered_at, e.sitio_id, e.empresa_id,
            e.repeticiones,
            a.nombre AS alerta_nombre,
            s.descripcion AS sitio_desc,
            s.tipo_sitio
     ${from}
     ${where ? `${where} AND ${pendientes}` : `WHERE ${pendientes}`}
     ORDER BY e.triggered_at DESC
     LIMIT 15`,
    params,
  );

  const counts = rows[0] || {};
  res.json({
    ok: true,
    data: {
      ...counts,
      // `no_leidas` se mantiene por compatibilidad con clientes viejos, pero
      // ahora refleja el conteo real de pendientes en vez de un 0 fijo.
      no_leidas: Number(counts.sin_revisar || 0),
      recientes,
    },
  });
};

/**
 * GET /api/alertas/destinatarios?empresa_id=
 *
 * Usuarios que pueden elegirse como destinatarios de una regla: los de la
 * empresa, activos, sin los SuperAdmin (a ellos los cubre la casilla
 * "avisar al equipo Emeltec"). Un Admin/Gerente solo ve su propia empresa; si
 * tiene sub-empresa, solo la suya. Endpoint propio en vez de GET /api/users
 * porque ese listado no está permitido para Gerente, que sí edita alarmas.
 */
exports.destinatariosPosibles = async (req, res, next) => {
  try {
    const esSuper = req.user.tipo === 'SuperAdmin';
    const pedida = typeof req.query.empresa_id === 'string' ? req.query.empresa_id : '';
    if (!esSuper && pedida && pedida !== req.user.empresa_id) {
      return res.status(403).json({ ok: false, error: 'Sin acceso a esa empresa' });
    }
    const empresaId = esSuper ? pedida || req.user.empresa_id : req.user.empresa_id;
    if (!empresaId) {
      return res.status(400).json({ ok: false, error: 'Falta empresa_id' });
    }

    const params = [empresaId];
    let filtroSub = '';
    if (!esSuper && req.user.sub_empresa_id) {
      params.push(req.user.sub_empresa_id);
      filtroSub = `AND sub_empresa_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT id, nombre, apellido, email, tipo, sub_empresa_id
         FROM usuario
        WHERE empresa_id = $1
          AND COALESCE(activo, TRUE)
          AND tipo <> 'SuperAdmin'
          ${filtroSub}
        ORDER BY nombre, apellido`,
      params,
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/alertas/simulacion?sitio_id=&variable_key=&limit=
 *
 * Lecturas para "Probar regla": las últimas 24 h de datos del equipo (contadas
 * desde su última lectura, no desde ahora, para que un equipo caído igual tenga
 * contra qué probar), con la variable ya TRANSFORMADA por el reg_map del sitio.
 * Es el mismo valor que ve el dashboard y el mismo que compara el worker
 * (`valorEvaluable`), así que el umbral se escribe en la unidad del reg_map.
 * Sin mapeo se devuelve el crudo. Solo lectura.
 */
exports.simulacionValores = async (req, res, next) => {
  try {
    const sitioId = typeof req.query.sitio_id === 'string' ? req.query.sitio_id : '';
    const variableKey = typeof req.query.variable_key === 'string' ? req.query.variable_key : '';
    const limitPedido = parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(limitPedido) ? limitPedido : 500, 1), 2000);
    if (!sitioId || !variableKey) {
      return res.status(400).json({ ok: false, error: 'Faltan sitio_id y variable_key' });
    }
    if (!(await userCanAccessSiteId(pool, req.user, sitioId))) {
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
    }

    const { rows: sitios } = await pool.query(
      'SELECT id, id_serial, tipo_sitio FROM sitio WHERE id = $1',
      [sitioId],
    );
    const sitio = sitios[0];
    if (!sitio) return res.status(404).json({ ok: false, error: 'Sitio no encontrado' });
    if (!sitio.id_serial) {
      return res.json({ ok: true, data: [], mapping: null, message: 'El sitio no tiene equipo.' });
    }

    const { rows: mapeos } = await pool.query(
      `SELECT id, sitio_id, alias, d1, d2, tipo_dato, unidad, rol_dashboard,
              transformacion, parametros
         FROM reg_map
        WHERE sitio_id = $1 AND d1 = $2
        ORDER BY alias
        LIMIT 1`,
      [sitioId, variableKey],
    );
    const mapping = mapeos[0] ?? null;

    let pozoConfig = null;
    if (mapping && normalizeTransform(mapping.transformacion) === 'nivel_freatico') {
      const { rows: pc } = await pool.query(
        'SELECT * FROM pozo_config WHERE sitio_id = $1 LIMIT 1',
        [sitioId],
      );
      pozoConfig = pc[0] ?? null;
    }

    const { rows: lecturas } = await pool.query(
      `SELECT time, data
         FROM equipo
        WHERE id_serial = $1
          AND time > (SELECT MAX(time) FROM equipo WHERE id_serial = $1) - INTERVAL '24 hours'
        ORDER BY time DESC
        LIMIT $2`,
      [sitio.id_serial, limit],
    );

    const data = lecturas.map((row) => {
      const crudo = row.data && typeof row.data === 'object' ? row.data[variableKey] : undefined;
      const out = {
        timestamp: row.time instanceof Date ? row.time.toISOString() : String(row.time),
        crudo: crudo === undefined ? null : crudo,
        valor: crudo === undefined ? null : crudo,
        ok: true,
        error: null,
      };
      if (mapping && crudo !== undefined && crudo !== null) {
        try {
          out.valor = applyMappingTransform({ rawData: row.data, mapping, pozoConfig });
        } catch (err) {
          out.ok = false;
          out.valor = null;
          out.error = err.message;
        }
      }
      return out;
    });

    res.json({
      ok: true,
      data,
      mapping: mapping
        ? { alias: mapping.alias, unidad: mapping.unidad, transformacion: mapping.transformacion }
        : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/alertas/recomendadas?sitio_id=
 *
 * Catálogo de reglas recomendadas evaluado contra el sitio: cuáles aplican
 * (y por qué no), cuáles ya existen. Es lo que muestra el selector.
 */
exports.listarRecomendadas = async (req, res, next) => {
  try {
    const sitioId = typeof req.query.sitio_id === 'string' ? req.query.sitio_id.trim() : '';
    if (!sitioId) return res.status(400).json({ ok: false, error: 'Falta sitio_id' });
    if (!(await userCanAccessSiteId(pool, req.user, sitioId))) {
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
    }
    const { listarAlertasRecomendadas } = require('../services/alertasPorDefecto');
    res.json({ ok: true, data: await listarAlertasRecomendadas(pool, { sitioId }) });
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ ok: false, error: err.message });
    next(err);
  }
};

/**
 * POST /api/alertas/recomendadas  { sitio_id, condiciones?: string[] }
 *
 * Crea las reglas recomendadas marcadas (o todas las que apliquen si no se
 * manda `condiciones`). Idempotente: una condición que ya existe se respeta.
 */
exports.crearRecomendadas = async (req, res, next) => {
  try {
    const sitioId = typeof req.body?.sitio_id === 'string' ? req.body.sitio_id.trim() : '';
    if (!sitioId) return res.status(400).json({ ok: false, error: 'Falta sitio_id' });
    const condiciones =
      req.body?.condiciones === undefined
        ? null
        : Array.isArray(req.body.condiciones)
          ? req.body.condiciones.filter((c) => typeof c === 'string')
          : undefined;
    if (condiciones === undefined) {
      return res.status(400).json({ ok: false, error: 'condiciones debe ser una lista' });
    }
    if (!(await userCanAccessSiteId(pool, req.user, sitioId))) {
      return res.status(403).json({ ok: false, error: 'Sin permisos sobre este sitio' });
    }
    const { crearAlertasPorDefecto } = require('../services/alertasPorDefecto');
    const resultado = await crearAlertasPorDefecto(pool, {
      sitioId,
      userId: req.user.id,
      condiciones,
    });
    res.status(resultado.creadas.length ? 201 : 200).json({ ok: true, data: resultado });
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ ok: false, error: err.message });
    next(err);
  }
};
