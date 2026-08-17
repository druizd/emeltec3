/**
 * Mapea una request de mutación → (action, targetType, targetId) para la
 * bitácora Ley 21.663.
 *
 * IMPORTANTE: se invoca ANTES del router (el middleware necesita leer el
 * estado previo del recurso para poder guardar el antes/después), así que
 * `req.params` todavía está vacío. El id se extrae de la URL.
 */

const VERBO_POR_METODO = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/** Primer segmento después del prefijo, o null si la URL es la colección. */
function idDespuesDe(path, prefijo) {
  const m = new RegExp(`^${prefijo}/([^/]+)`).exec(path);
  return (m && m[1]) || null;
}

function resolveTarget(path) {
  if (path.startsWith('/api/users')) {
    return { targetType: 'usuario', targetId: idDespuesDe(path, '/api/users') };
  }
  if (path.startsWith('/api/companies')) {
    // /api/companies cubre empresas Y sitios (y sub-recursos del sitio). Sin
    // separarlos, todo quedaba etiquetado como 'empresa' con el id de un
    // sitio, y el estado previo se leería de la tabla equivocada.
    const sitio = /^\/api\/companies\/sites\/([^/]+)/.exec(path);
    if (sitio) return { targetType: 'sitio', targetId: sitio[1] };
    return { targetType: 'empresa', targetId: idDespuesDe(path, '/api/companies') };
  }
  if (path.startsWith('/api/eventos')) {
    return { targetType: 'evento', targetId: idDespuesDe(path, '/api/eventos') };
  }
  if (path.startsWith('/api/alertas')) {
    return { targetType: 'alerta', targetId: idDespuesDe(path, '/api/alertas') };
  }
  if (path.startsWith('/api/incidencias')) {
    return { targetType: 'incidencia', targetId: idDespuesDe(path, '/api/incidencias') };
  }
  if (path.startsWith('/api/documentos')) {
    return { targetType: 'documento', targetId: idDespuesDe(path, '/api/documentos') };
  }
  return { targetType: null, targetId: null };
}

/**
 * Activar/desactivar entra por el mismo PUT que una edición completa. Sin
 * distinguirlo, prender y apagar una alarma queda idéntico en la bitácora a
 * cambiarle el umbral.
 */
function refinarVerbo(verbo, body) {
  if (verbo !== 'update' || !body || typeof body !== 'object') return verbo;
  const claves = Object.keys(body);
  if (claves.length !== 1 || claves[0] !== 'activa') return verbo;
  return body.activa ? 'enable' : 'disable';
}

function auditResolver(req) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  const { targetType, targetId } = resolveTarget(path);
  const verbo = VERBO_POR_METODO[req.method] || 'mutate';
  const accion = refinarVerbo(verbo, req.body);
  return {
    action: targetType ? `${targetType}.${accion}` : `${String(req.method).toLowerCase()}.unknown`,
    targetType,
    targetId,
  };
}

module.exports = { auditResolver, resolveTarget, refinarVerbo };
