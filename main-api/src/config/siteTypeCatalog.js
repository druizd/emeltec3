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
  {
    id: 'uint32_registros',
    label: 'D1 * D2',
    description: 'Combina dos registros Modbus: (registro alto * 65536) + registro bajo.',
    enabled: true,
    requiresD2: true,
  },
];

const SITE_TYPE_CATALOG = {
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
      {
        id: 'caudal',
        label: 'Caudal',
        unitHint: 'L/s',
        description: 'Flujo instantaneo del pozo.',
      },
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
      {
        id: 'energia',
        label: 'Energia',
        unitHint: 'kWh',
        description: 'Energia acumulada o consumida.',
      },
      {
        id: 'energia_activa_kwh',
        label: 'Energia activa',
        unitHint: 'kWh',
        description: 'Energia activa consumida en el periodo.',
      },
      {
        id: 'energia_reactiva_kvarh',
        label: 'Energia reactiva',
        unitHint: 'kVArh',
        description: 'Energia reactiva acumulada.',
      },
      {
        id: 'factor_potencia_total',
        label: 'Factor potencia total',
        unitHint: '',
        description: 'Factor de potencia total del tablero.',
      },
      {
        id: 'factor_potencia_l1',
        label: 'Factor potencia L1',
        unitHint: '',
        description: 'Factor de potencia fase L1.',
      },
      {
        id: 'factor_potencia_l2',
        label: 'Factor potencia L2',
        unitHint: '',
        description: 'Factor de potencia fase L2.',
      },
      {
        id: 'factor_potencia_l3',
        label: 'Factor potencia L3',
        unitHint: '',
        description: 'Factor de potencia fase L3.',
      },
      { id: 'voltaje_l1', label: 'Voltaje L1', unitHint: 'V', description: 'Voltaje fase L1.' },
      { id: 'voltaje_l2', label: 'Voltaje L2', unitHint: 'V', description: 'Voltaje fase L2.' },
      { id: 'voltaje_l3', label: 'Voltaje L3', unitHint: 'V', description: 'Voltaje fase L3.' },
      {
        id: 'corriente_l1',
        label: 'Corriente L1',
        unitHint: 'A',
        description: 'Corriente fase L1.',
      },
      {
        id: 'corriente_l2',
        label: 'Corriente L2',
        unitHint: 'A',
        description: 'Corriente fase L2.',
      },
      {
        id: 'corriente_l3',
        label: 'Corriente L3',
        unitHint: 'A',
        description: 'Corriente fase L3.',
      },
      {
        id: 'potencia_activa_total_kw',
        label: 'Potencia activa total',
        unitHint: 'kW',
        description: 'Potencia activa total del tablero.',
      },
      {
        id: 'potencia_reactiva_total_kvar',
        label: 'Potencia reactiva total',
        unitHint: 'kVAr',
        description: 'Potencia reactiva total del tablero.',
      },
      {
        id: 'thd_corriente_l1',
        label: 'THD corriente L1',
        unitHint: '%',
        description: 'Distorsion armonica de corriente L1.',
      },
      {
        id: 'thd_corriente_l2',
        label: 'THD corriente L2',
        unitHint: '%',
        description: 'Distorsion armonica de corriente L2.',
      },
      {
        id: 'thd_corriente_l3',
        label: 'THD corriente L3',
        unitHint: '%',
        description: 'Distorsion armonica de corriente L3.',
      },
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
      {
        id: 'totalizador',
        label: 'Totalizador',
        unitHint: 'm3',
        description: 'Volumen acumulado.',
      },
      { id: 'presion', label: 'Presion', unitHint: 'bar', description: 'Presion de proceso.' },
      { id: 'ph', label: 'pH', unitHint: 'pH', description: 'Nivel de acidez o alcalinidad.' },
      {
        id: 'conductividad',
        label: 'Conductividad',
        unitHint: 'uS/cm',
        description: 'Conductividad electrica del efluente.',
      },
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura del efluente.',
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
  camara_frio: {
    id: 'camara_frio',
    label: 'Camara de frio',
    roles: [
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura principal de la camara.',
      },
      {
        id: 'humedad',
        label: 'Humedad',
        unitHint: '%',
        description: 'Humedad relativa de la camara.',
      },
      {
        id: 'setpoint',
        label: 'Setpoint',
        unitHint: 'C',
        description: 'Temperatura objetivo configurada.',
      },
      { id: 'estado', label: 'Estado', unitHint: '', description: 'Estado operativo.' },
      { id: 'alarma', label: 'Alarma', unitHint: '', description: 'Estado de alarma.' },
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
      {
        id: 'temperatura',
        label: 'Temperatura',
        unitHint: 'C',
        description: 'Temperatura de proceso.',
      },
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

const SITE_TYPE_IDS = Object.freeze(Object.keys(SITE_TYPE_CATALOG));
const VARIABLE_ROLE_IDS = Object.freeze([
  ...new Set([
    ...Object.values(SITE_TYPE_CATALOG).flatMap((config) => config.roles.map((role) => role.id)),
    'nivel_freatico',
  ]),
]);
const VARIABLE_TRANSFORM_IDS = Object.freeze([
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

function getSiteTypeCatalog() {
  return JSON.parse(JSON.stringify(SITE_TYPE_CATALOG));
}

module.exports = {
  getSiteTypeCatalog,
  SITE_TYPE_IDS,
  VARIABLE_ROLE_IDS,
  VARIABLE_TRANSFORM_IDS,
};
