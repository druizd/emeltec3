/**
 * Resolver de auditoría del router v2.
 *
 * `auditMutations` se monta UNA vez al inicio del router (ver routes.ts), antes
 * de `protect`, para que una escritura rechazada (403 de "ver como", de rol o de
 * 2FA) también deje fila en audit_log, como pasa en v1 (app.js). Como corre antes
 * de que Express resuelva la ruta, el resolver lee la URL y el body: `req.params`
 * aún está vacío.
 *
 * Una sola entrada por petición: las rutas ya no montan su propio audit. Los
 * nombres de acción de DGA y digest se mantienen idénticos a los históricos.
 */
import type { Request } from 'express';

export interface AuditInfo {
  action: string;
  targetType?: string;
  targetId?: string;
}

function resolveDgaAudit(req: Request): AuditInfo {
  const path = req.path;
  // PATCH /dga/sites/:siteId/pozo-config
  const pozoMatch = /^\/dga\/sites\/([^/]+)\/pozo-config$/.exec(path);
  if (req.method === 'PATCH' && pozoMatch) {
    return {
      action: 'dga.pozo_config.patch',
      targetType: 'pozo_config',
      targetId: pozoMatch[1] ?? '',
    };
  }
  // POST /dga/informantes (create)
  if (req.method === 'POST' && path === '/dga/informantes') {
    return {
      action: 'dga.informante.upsert',
      targetType: 'dga_informante',
      targetId: String(req.body?.rut ?? ''),
    };
  }
  // PATCH /dga/informantes/:rut
  const infMatch = /^\/dga\/informantes\/([^/]+)$/.exec(path);
  if (req.method === 'PATCH' && infMatch) {
    return {
      action: 'dga.informante.upsert',
      targetType: 'dga_informante',
      targetId: infMatch[1] ?? '',
    };
  }
  if (req.method === 'DELETE' && infMatch) {
    return {
      action: 'dga.informante.delete',
      targetType: 'dga_informante',
      targetId: infMatch[1] ?? '',
    };
  }
  if (req.method === 'POST' && path === '/dga/review-queue/action') {
    return {
      action: `dga.review.${req.body?.action ?? 'unknown'}`,
      targetType: 'dato_dga',
      targetId: `${req.body?.site_id ?? ''}::${req.body?.ts ?? ''}`,
    };
  }
  // POST /dga/review-queue/bulk — el lote es UNA acción. El targetId resume a
  // qué tocó: los sitios involucrados y cuántos slots. La lista completa no
  // entra en una columna, y para reconstruir el detalle están los propios
  // slots, que guardan la nota del admin.
  if (req.method === 'POST' && path === '/dga/review-queue/bulk') {
    const items: Array<{ site_id?: string }> = Array.isArray(req.body?.items) ? req.body.items : [];
    const sitios = [...new Set(items.map((i) => i?.site_id ?? '').filter(Boolean))];
    return {
      action: `dga.review.bulk.${req.body?.action ?? 'unknown'}`,
      targetType: 'dato_dga',
      targetId: `${sitios.join(',') || 'sin_sitio'}::${items.length} slots`,
    };
  }
  // POST /dga/sites/:siteId/slots/bulk — la nota del operador y el rango son
  // la única constancia de por qué un tramo se recalculó o no se declaró, así
  // que van al audit_log y no al fallback `unknown`.
  const bulkMatch = /^\/dga\/sites\/([^/]+)\/slots\/bulk$/.exec(path);
  if (req.method === 'POST' && bulkMatch) {
    return {
      action: `dga.slots.${req.body?.action ?? 'unknown'}`,
      targetType: 'dato_dga',
      targetId: `${bulkMatch[1] ?? ''}::${req.body?.desde ?? ''}..${req.body?.hasta ?? ''}`,
    };
  }
  const reconMatch = path.match(/^\/dga\/sites\/([^/]+)\/reconocer-sensor-defectuoso$/);
  if (req.method === 'POST' && reconMatch) {
    return {
      action: 'dga.sensor.reconocer_defectuoso',
      targetType: 'sitio',
      targetId: reconMatch[1] ?? '',
    };
  }
  return { action: `dga.${req.method.toLowerCase()}.unknown` };
}

function resolveHealthDigestAudit(req: Request): AuditInfo | null {
  if (req.method === 'PUT' && req.path === '/health-digest/destinatarios') {
    return {
      action: 'health_digest.destinatarios.update',
      targetType: 'health_digest_destinatario',
      targetId: 'lista',
    };
  }
  if (req.method === 'PUT' && req.path === '/health-digest/config') {
    return {
      action: 'health_digest.config.update',
      targetType: 'health_digest_config',
      targetId: 'global',
    };
  }
  if (req.method === 'POST' && req.path === '/health-digest/prueba') {
    return {
      action: 'health_digest.prueba.send',
      targetType: 'health_digest_config',
      targetId: 'global',
    };
  }
  return null;
}

/**
 * [método, segmentos, acción, targetType]. En los segmentos, `:` marca un
 * parámetro; el ÚLTIMO parámetro de la ruta es el targetId.
 */
const RUTAS_ESCRITURA: ReadonlyArray<readonly [string, string, string, string]> = [
  ['POST', '/auth/view-as', 'auth.view_as', 'sesion'],
  ['POST', '/companies/contacts/:id/reveal', 'contacto_operativo.reveal', 'contacto_operativo'],
  ['POST', '/users/:id/reveal', 'usuario.reveal_phone', 'usuario'],
  ['PATCH', '/sites/:siteId/bitacora/ficha', 'bitacora.ficha.patch', 'bitacora_ficha'],
  ['POST', '/sites/:siteId/bitacora/contacto', 'bitacora.contacto.create', 'bitacora_contacto'],
  [
    'POST',
    '/sites/:siteId/bitacora/contacto/:id/reveal',
    'bitacora.contacto.reveal',
    'bitacora_contacto',
  ],
  ['PATCH', '/sites/:siteId/bitacora/contacto/:id', 'bitacora.contacto.patch', 'bitacora_contacto'],
  [
    'DELETE',
    '/sites/:siteId/bitacora/contacto/:id',
    'bitacora.contacto.delete',
    'bitacora_contacto',
  ],
  ['POST', '/sites/:siteId/bitacora/equipos', 'bitacora.equipo.create', 'bitacora_equipo'],
  ['PATCH', '/sites/bitacora/equipos/:id', 'bitacora.equipo.patch', 'bitacora_equipo'],
  ['DELETE', '/sites/bitacora/equipos/:id', 'bitacora.equipo.delete', 'bitacora_equipo'],
];

/** Devuelve el último parámetro de `path` si encaja con `template`; null si no encaja. */
function matchTemplate(template: string, path: string): string | null {
  const t = template.split('/');
  const p = path.split('/');
  if (t.length !== p.length) return null;
  let lastParam = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i]!.startsWith(':')) {
      if (!p[i]) return null;
      lastParam = p[i]!;
    } else if (t[i] !== p[i]) {
      return null;
    }
  }
  return lastParam;
}

/**
 * Acción y objetivo de una escritura v2. Una ruta nueva sin entrada cae en
 * `v2.<método>.sin_mapear` (la URL completa queda en `metadata.path`): se audita
 * igual en vez de quedar en silencio.
 */
export function resolveV2Audit(req: Request): AuditInfo {
  if (req.path.startsWith('/dga/')) return resolveDgaAudit(req);
  const digest = resolveHealthDigestAudit(req);
  if (digest) return digest;
  for (const [method, template, action, targetType] of RUTAS_ESCRITURA) {
    if (req.method !== method) continue;
    const targetId = matchTemplate(template, req.path);
    if (targetId !== null) return { action, targetType, targetId };
  }
  return { action: `v2.${req.method.toLowerCase()}.sin_mapear` };
}
