/**
 * Catálogo de tipos de sitio y sus roles + transformaciones disponibles.
 */

export interface VariableTransform {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  requiresD2?: boolean;
}

export interface VariableRole {
  id: string;
  label: string;
  unitHint: string;
  description: string;
}

export interface SiteTypeConfig {
  id: string;
  label: string;
  roles: VariableRole[];
  transforms: VariableTransform[];
}

const COMMON_TRANSFORMS: VariableTransform[] = [
  { id: 'directo', label: 'Directo', description: 'Usa el valor entrante sin modificarlo.', enabled: true },
  { id: 'lineal', label: 'Lineal', description: 'Aplica valor * factor + offset.', enabled: true },
  {
    id: 'ieee754_32',
    label: 'IEEE754 32 bits',
    description: 'Une dos registros Modbus para obtener un FLOAT32.',
    enabled: true,
    requiresD2: true,
  },
  {
    id: 'uint32_registros',
    label: 'D1 * D2',
    description: 'Combina dos registros Modbus: (registro alto * 65536) + registro bajo.',
    enabled: true,
    requiresD2: true,
  },
];

const SITE_TYPE_CATALOG: Record<string, SiteTypeConfig> = {
  pozo: {
    id: 'pozo',
    label: 'Pozo',
    roles: [
      {
        id: 'nivel',
        label: 'Nivel',
        unitHint: 'm',
        description: 'Lectura del sensor usada para calcular el nivel freatico del pozo.',
      },
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo del pozo.' },
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado o caudal totalizado.',
      },
      {
        id: 'generico',
        label: 'Generico',
        unitHint: '',
        description: 'Variable auxiliar sin uso especial en dashboard.',
      },
    ],
    transforms: [...COMMON_TRANSFORMS],
  },
  electrico: {
    id: 'electrico',
    label: 'Electrico',
    roles: [
      { id: 'energia', label: 'Energia', unitHint: 'kWh', description: 'Energia acumulada o consumida.' },
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo del equipo.' },
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura asociada al tablero o equipo.',
      },
      {
        id: 'generico',
        label: 'Generico',
        unitHint: '',
        description: 'Variable auxiliar sin uso especial en dashboard.',
      },
    ],
    transforms: [...COMMON_TRANSFORMS],
  },
  riles: {
    id: 'riles',
    label: 'Riles',
    roles: [
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo.' },
      { id: 'totalizador', label: 'Totalizador', unitHint: 'm3', description: 'Volumen acumulado.' },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      {
        id: 'generico',
        label: 'Generico',
        unitHint: '',
        description: 'Variable auxiliar sin uso especial en dashboard.',
      },
    ],
    transforms: [...COMMON_TRANSFORMS],
  },
  proceso: {
    id: 'proceso',
    label: 'Proceso',
    roles: [
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo.' },
      { id: 'temperatura', label: 'Temperatura', unitHint: 'C', description: 'Temperatura de proceso.' },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      {
        id: 'generico',
        label: 'Generico',
        unitHint: '',
        description: 'Variable auxiliar sin uso especial en dashboard.',
      },
    ],
    transforms: [...COMMON_TRANSFORMS],
  },
  generico: {
    id: 'generico',
    label: 'Generico',
    roles: [
      {
        id: 'generico',
        label: 'Generico',
        unitHint: '',
        description: 'Variable auxiliar sin uso especial en dashboard.',
      },
    ],
    transforms: [...COMMON_TRANSFORMS],
  },
};

export const SITE_TYPE_IDS: ReadonlyArray<string> = Object.freeze(Object.keys(SITE_TYPE_CATALOG));

export const VARIABLE_ROLE_IDS: ReadonlyArray<string> = Object.freeze([
  ...new Set([
    ...Object.values(SITE_TYPE_CATALOG).flatMap((c) => c.roles.map((r) => r.id)),
    'nivel_freatico',
  ]),
]);

export const VARIABLE_TRANSFORM_IDS: ReadonlyArray<string> = Object.freeze([
  'directo',
  'ieee754',
  'ieee754_32',
  'lineal',
  'escala_lineal',
  'formula',
  'uint32_registros',
  'uint32',
  'nivel_freatico',
  'caudal',
  'caudal_m3h_lps',
]);

export function getSiteTypeCatalog(): Record<string, SiteTypeConfig> {
  return JSON.parse(JSON.stringify(SITE_TYPE_CATALOG)) as Record<string, SiteTypeConfig>;
}
