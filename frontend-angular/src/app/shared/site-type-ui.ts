import type { SiteRecord } from '@emeltec/shared';

export interface SiteModuleUi {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
  siteTypes: readonly string[];
}

export interface SiteTypeUi {
  id: string;
  label: string;
  icon: string;
  moduleKey: string;
  routeSegment: string;
  badgeClass: string;
}

export const SITE_MODULES: SiteModuleUi[] = [
  {
    key: 'Agua',
    label: 'Consumo de Agua',
    icon: 'water_drop',
    color: '#0dafbd',
    bg: 'rgba(13,175,189,0.10)',
    border: 'rgba(13,175,189,0.25)',
    siteTypes: ['pozo', 'vertiente', 'canal'],
  },
  {
    key: 'Electrico',
    label: 'Consumo Eléctrico',
    icon: 'bolt',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.20)',
    siteTypes: ['electrico'],
  },
  {
    key: 'Riles',
    label: 'Generación de Riles',
    icon: 'waves',
    color: '#22c55e',
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.20)',
    siteTypes: ['riles'],
  },
  {
    key: 'Frio',
    label: 'Cámaras de Frío',
    icon: 'ac_unit',
    color: '#0284c7',
    bg: 'rgba(2,132,199,0.08)',
    border: 'rgba(2,132,199,0.20)',
    siteTypes: ['camara_frio'],
  },
  {
    key: 'Proceso',
    label: 'Variables de Proceso',
    icon: 'memory',
    color: '#6366f1',
    bg: 'rgba(99,102,241,0.08)',
    border: 'rgba(99,102,241,0.20)',
    siteTypes: ['proceso', 'pasteurizador'],
  },
  {
    key: '_other',
    label: 'Maletas Pilotos',
    icon: 'rocket_launch',
    color: '#f97316',
    bg: 'rgba(249,115,22,0.08)',
    border: 'rgba(249,115,22,0.20)',
    siteTypes: ['generico', 'maleta'],
  },
];

const SITE_TYPE_UI: Record<string, SiteTypeUi> = {
  pozo: {
    id: 'pozo',
    label: 'Pozo',
    icon: 'water_drop',
    moduleKey: 'Agua',
    routeSegment: 'water',
    badgeClass: 'bg-primary-tint-10 text-primary-container',
  },
  vertiente: {
    id: 'vertiente',
    label: 'Vertiente',
    icon: 'water_drop',
    moduleKey: 'Agua',
    routeSegment: 'vertiente',
    badgeClass: 'bg-cyan-50 text-cyan-700',
  },
  canal: {
    id: 'canal',
    label: 'Canal',
    icon: 'waves',
    moduleKey: 'Agua',
    routeSegment: 'canal',
    badgeClass: 'bg-sky-50 text-sky-700',
  },
  electrico: {
    id: 'electrico',
    label: 'Electrico',
    icon: 'bolt',
    moduleKey: 'Electrico',
    routeSegment: 'electric',
    badgeClass: 'bg-amber-50 text-amber-700',
  },
  riles: {
    id: 'riles',
    label: 'Riles',
    icon: 'waves',
    moduleKey: 'Riles',
    routeSegment: 'riles',
    badgeClass: 'bg-emerald-50 text-emerald-700',
  },
  camara_frio: {
    id: 'camara_frio',
    label: 'Camara de frio',
    icon: 'ac_unit',
    moduleKey: 'Frio',
    routeSegment: 'cold-room',
    badgeClass: 'bg-sky-50 text-sky-700',
  },
  proceso: {
    id: 'proceso',
    label: 'Proceso',
    icon: 'memory',
    moduleKey: 'Proceso',
    routeSegment: 'process',
    badgeClass: 'bg-indigo-50 text-indigo-700',
  },
  pasteurizador: {
    id: 'pasteurizador',
    label: 'Pasteurizador',
    icon: 'device_thermostat',
    moduleKey: 'Proceso',
    routeSegment: 'pasteurizador',
    badgeClass: 'bg-rose-50 text-rose-700',
  },
  generico: {
    id: 'generico',
    label: 'Generico',
    icon: 'sensors',
    moduleKey: '_other',
    routeSegment: 'generic',
    badgeClass: 'bg-slate-100 text-slate-600',
  },
  maleta: {
    id: 'maleta',
    label: 'Maleta piloto',
    icon: 'rocket_launch',
    moduleKey: '_other',
    routeSegment: 'generic',
    badgeClass: 'bg-orange-50 text-orange-700',
  },
};

export function normalizeSiteType(value: string | null | undefined): string {
  const normalized = (value || 'generico')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return 'generico';
  if (normalized.includes('vertiente')) return 'vertiente';
  if (normalized.includes('canal')) return 'canal';
  if (normalized.includes('pozo') || normalized.includes('agua')) return 'pozo';
  if (normalized.includes('elect')) return 'electrico';
  if (normalized.includes('ril')) return 'riles';
  if (normalized.includes('pasteur')) return 'pasteurizador';
  if (normalized.includes('camara') || normalized.includes('frio') || normalized.includes('cold')) {
    return 'camara_frio';
  }
  if (normalized.includes('proceso') || normalized.includes('variable')) return 'proceso';
  if (normalized.includes('maleta')) return 'maleta';
  if (normalized.includes('generic')) return 'generico';

  return normalized;
}

export function getSiteTypeUi(value: string | null | undefined): SiteTypeUi {
  const id = normalizeSiteType(value);
  return SITE_TYPE_UI[id] || { ...SITE_TYPE_UI['generico'], id, label: value || 'Generico' };
}

export function getModuleByKey(moduleKey: string): SiteModuleUi | undefined {
  return SITE_MODULES.find((module) => module.key === moduleKey);
}

export function siteTypesForModule(moduleKey: string): string[] {
  return [...(getModuleByKey(moduleKey)?.siteTypes || ['generico'])];
}

export function siteTypeMatchesModule(
  value: string | null | undefined,
  moduleKey: string,
): boolean {
  const type = normalizeSiteType(value);
  const module = getModuleByKey(moduleKey);

  if (!module) return false;
  if (module.key === '_other') {
    const knownOperationalTypes = SITE_MODULES.filter((item) => item.key !== '_other').flatMap(
      (item) => item.siteTypes,
    );
    return !knownOperationalTypes.includes(type) || module.siteTypes.includes(type);
  }

  return module.siteTypes.includes(type);
}

/**
 * Agrupación visual de un sitio en un módulo del sidebar/dashboard.
 *
 * Si el sitio tiene `es_maleta_piloto`, se fuerza al módulo "Maletas Pilotos"
 * (`_other`) y NO aparece en su módulo operativo normal. Si no, se agrupa por
 * `tipo_sitio` como siempre. La lógica de detalle (qué vista abre) sigue
 * dependiendo de `tipo_sitio`, no de este override.
 */
export function siteMatchesModule(
  site: Pick<SiteRecord, 'tipo_sitio' | 'es_maleta_piloto'>,
  moduleKey: string,
): boolean {
  if (site.es_maleta_piloto) {
    return moduleKey === '_other';
  }
  return siteTypeMatchesModule(site.tipo_sitio, moduleKey);
}

function tapRouteSegmentForSite(site: SiteRecord): string | null {
  const candidates = [site.descripcion, site.ubicacion, site.id_serial];

  for (const value of candidates) {
    const match = value?.match(/\btap\s*[-_:#]?\s*(\d{1,2})\b/i);
    if (!match) continue;

    const tapNumber = Number(match[1]);
    if (Number.isInteger(tapNumber) && tapNumber > 0) {
      return `TAP-${tapNumber}`;
    }
  }

  return null;
}

export function dashboardRouteForSite(site: SiteRecord): string[] {
  const type = normalizeSiteType(site.tipo_sitio);
  if (type === 'camara_frio') {
    // Todos entran a la vista general (mapa + salas) en /cold-room. El detalle
    // técnico de TAP (/tap/:tapId) es solo-admin y se alcanza desde la pestaña
    // "TAP (técnico)" del general (visible solo para admin).
    return ['/companies', site.id, 'cold-room'];
  }
  return ['/companies', site.id, getSiteTypeUi(site.tipo_sitio).routeSegment];
}
