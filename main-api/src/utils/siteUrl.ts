/**
 * URL del detalle de un sitio en el frontend, para links en correos.
 *
 * Espejo de `frontend-angular/src/app/shared/site-type-ui.ts` (routeSegment):
 * si allá cambia un segmento, acá también. El fallback es 'generic' porque es
 * una ruta que existe para cualquier tipo; 'water' abriría un detalle de pozo
 * sobre un sitio que no lo es.
 */
const FRONTEND_BASE = (process.env.FRONTEND_URL || 'https://nuevacloud.emeltec.cl/login').replace(
  /\/login\/?$/,
  '',
);

const TIPO_RUTA: Record<string, string> = {
  pozo: 'water',
  vertiente: 'vertiente',
  canal: 'canal',
  electrico: 'electric',
  riles: 'riles',
  camara_frio: 'cold-room',
  proceso: 'process',
  pasteurizador: 'pasteurizador',
  generico: 'generic',
  maleta: 'generic',
};

export function siteUrl(siteId: string, tipo: string | null | undefined, tab?: string): string {
  const seg = TIPO_RUTA[tipo ?? ''] ?? 'generic';
  const base = `${FRONTEND_BASE}/companies/${siteId}/${seg}`;
  return tab ? `${base}?tab=${encodeURIComponent(tab)}` : base;
}

export { FRONTEND_BASE, TIPO_RUTA };
