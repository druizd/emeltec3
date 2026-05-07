const COMMON_TRANSFORMS = [
  {
    id: 'directo',
    label: 'Directo',
    description: 'Usa el valor entrante sin modificarlo.',
    enabled: true,
  },
  {
    id: 'lineal',
    label: 'Lineal',
    description: 'Aplica valor * factor + offset.',
    enabled: true,
  },
  {
    id: 'ieee754_32',
    label: 'IEEE754 32 bits',
    description: 'Une dos registros Modbus para obtener un FLOAT32.',
    enabled: true,
    requiresD2: true,
  },
];

const SITE_TYPE_CATALOG = {
  pozo: {
    id: 'pozo',
    label: 'Pozo',
    roles: [
      { id: 'nivel', label: 'Nivel agua', unitHint: 'm', description: 'Lectura de nivel recibida desde el sensor.' },
      { id: 'nivel_freatico', label: 'Nivel freatico', unitHint: 'm', description: 'Nivel calculado usando la configuracion del pozo.' },
      { id: 'caudal', label: 'Caudal', unitHint: 'L/s', description: 'Flujo instantaneo del pozo.' },
      { id: 'totalizador', label: 'Totalizador', unitHint: 'm3', description: 'Volumen acumulado o caudal totalizado.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar sin uso especial en dashboard.' },
    ],
    transforms: [
      ...COMMON_TRANSFORMS,
      {
        id: 'caudal_m3h_lps',
        label: 'Caudal m3/h a L/s',
        description: 'Convierte caudal desde m3/h hacia L/s.',
        enabled: true,
      },
      {
        id: 'nivel_freatico',
        label: 'Nivel freatico',
        description: 'Calcula nivel freatico desde lectura de pozo y profundidades configuradas.',
        enabled: true,
      },
    ],
  },
  electrico: {
    id: 'electrico',
    label: 'Electrico',
    roles: [
      { id: 'energia', label: 'Energia', unitHint: 'kWh', description: 'Energia acumulada o consumida.' },
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo del equipo.' },
      { id: 'temperatura', label: 'Temperatura', unitHint: 'C', description: 'Temperatura asociada al tablero o equipo.' },
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar sin uso especial en dashboard.' },
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
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar sin uso especial en dashboard.' },
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
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar sin uso especial en dashboard.' },
    ],
    transforms: [...COMMON_TRANSFORMS],
  },
  generico: {
    id: 'generico',
    label: 'Generico',
    roles: [
      { id: 'generico', label: 'Generico', unitHint: '', description: 'Variable auxiliar sin uso especial en dashboard.' },
    ],
    transforms: [...COMMON_TRANSFORMS],
  },
};

SITE_TYPE_CATALOG.riles.transforms = [
  ...COMMON_TRANSFORMS,
  {
    id: 'caudal_m3h_lps',
    label: 'Caudal m3/h a L/s',
    description: 'Convierte caudal desde m3/h hacia L/s.',
    enabled: true,
  },
];

const SITE_TYPE_IDS = Object.freeze(Object.keys(SITE_TYPE_CATALOG));
const VARIABLE_ROLE_IDS = Object.freeze([
  ...new Set(Object.values(SITE_TYPE_CATALOG).flatMap((config) => config.roles.map((role) => role.id))),
]);
const VARIABLE_TRANSFORM_IDS = Object.freeze([
  'directo',
  'ieee754',
  'ieee754_32',
  'lineal',
  'escala_lineal',
  'formula',
  'nivel_freatico',
  'caudal',
  'caudal_m3h_lps',
]);

function getSiteTypeCatalog() {
  return JSON.parse(JSON.stringify(SITE_TYPE_CATALOG));
}

module.exports = {
  getSiteTypeCatalog,
  SITE_TYPE_IDS,
  VARIABLE_ROLE_IDS,
  VARIABLE_TRANSFORM_IDS,
};
