const { m3hALs } = require('../utils/caudal');
const { parseIEEE754, registrosModbusAFloat32 } = require('../utils/ieee754');
const { calcularNivelFreatico } = require('../utils/nivelFreatico');
const { VARIABLE_TRANSFORM_IDS } = require('../config/siteTypeCatalog');

const VARIABLE_TRANSFORMS = new Set(VARIABLE_TRANSFORM_IDS);

function cleanString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function parseMappingParams(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};

  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireFiniteNumber(value, label) {
  const parsed = numberOrNull(value);
  if (parsed === null) {
    throw new Error(`${label} debe ser numerico`);
  }
  return parsed;
}

function readRawValue(rawData, key) {
  if (!key || !isPlainObject(rawData)) return undefined;
  return rawData[key];
}

function parseBooleanParam(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'yes'].includes(String(value).trim().toLowerCase());
}

function normalizeVariableTransform(value) {
  const normalized = cleanString(value).toLowerCase();
  const allowedValue = normalized || 'directo';
  if (!VARIABLE_TRANSFORMS.has(allowedValue)) return null;
  if (allowedValue === 'escala_lineal') return 'lineal';
  if (allowedValue === 'ieee754') return 'ieee754_32';
  if (allowedValue === 'caudal') return 'caudal_m3h_lps';
  return allowedValue;
}

function normalizeTransform(value) {
  return normalizeVariableTransform(value) || cleanString(value).toLowerCase();
}

function applyLinearTransform(value, params = {}) {
  const base = requireFiniteNumber(value, 'valor');
  const factor = numberOrNull(params.factor) ?? 1;
  const offset = numberOrNull(params.offset) ?? 0;
  return (base * factor) + offset;
}

function applyIeeeTransform({ rawData, mapping, params }) {
  const rawD1 = readRawValue(rawData, mapping.d1);
  const rawD2 = readRawValue(rawData, mapping.d2);

  if (mapping.d2) {
    const wordAlta = requireFiniteNumber(rawD1, mapping.d1);
    const wordBaja = requireFiniteNumber(rawD2, mapping.d2);
    const wordSwap = parseBooleanParam(params.word_swap ?? params.wordSwap, false);
    return registrosModbusAFloat32(wordAlta, wordBaja, wordSwap).valor;
  }

  if (rawD1 === undefined || rawD1 === null) {
    throw new Error(`No existe dato crudo ${mapping.d1}`);
  }

  return parseIEEE754(rawD1, {
    formato: params.formato || 'float32',
    byteOrder: params.byteOrder || params.word_order || 'BE',
  });
}

function applyMappingTransform({ rawData, mapping, pozoConfig }) {
  const params = parseMappingParams(mapping.parametros);
  const transformacion = normalizeTransform(mapping.transformacion);
  const rawD1 = readRawValue(rawData, mapping.d1);

  switch (transformacion) {
    case 'directo':
      return rawD1;

    case 'lineal':
      return applyLinearTransform(rawD1, params);

    case 'ieee754_32':
      return applyIeeeTransform({ rawData, mapping, params });

    case 'nivel_freatico': {
      const lecturaPozo = applyLinearTransform(rawD1, params);
      return calcularNivelFreatico({
        lecturaPozo,
        profundidadSensor: numberOrNull(pozoConfig?.profundidad_sensor_m),
        profundidadTotal: requireFiniteNumber(pozoConfig?.profundidad_pozo_m, 'profundidad_pozo_m'),
      });
    }

    case 'caudal_m3h_lps': {
      const caudalM3h = applyLinearTransform(rawD1, params);
      return m3hALs(caudalM3h);
    }

    case 'formula':
      throw new Error('transformacion formula aun no esta habilitada en dashboard-data');

    default:
      throw new Error(`transformacion no soportada: ${mapping.transformacion}`);
  }
}

function responseKeyForMapping(mapping) {
  if (mapping.rol_dashboard && mapping.rol_dashboard !== 'generico') return mapping.rol_dashboard;
  return cleanString(mapping.alias)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || mapping.d1;
}

function dashboardRoleForVariable(variable) {
  if (
    variable.transformacion === 'nivel_freatico' ||
    variable.key === 'nivel_freatico' ||
    variable.rol_dashboard === 'nivel_freatico'
  ) {
    return 'nivel_freatico';
  }

  return variable.rol_dashboard || 'generico';
}

function normalizeSearchText(...values) {
  return values
    .map((value) => cleanString(value))
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isLevelSensorVariable(variable) {
  if (variable.rol_dashboard === 'nivel') return true;

  const text = normalizeSearchText(variable.alias, variable.key, variable.fuente?.d1);
  if (text.includes('freatico')) return false;

  return [
    'nivel agua',
    'nivel',
    'level',
    'sonda',
    'lectura pozo',
    'columna agua',
    'altura agua',
  ].some((token) => text.includes(token));
}

function findRawLevelSensor(rawData) {
  if (!isPlainObject(rawData)) return null;

  for (const [key, value] of Object.entries(rawData)) {
    const text = normalizeSearchText(key);
    const numericValue = numberOrNull(value);

    if (
      numericValue !== null &&
      !text.includes('freatico') &&
      (text.includes('nivel') || text.includes('level') || text.includes('sonda') || text.includes('altura agua'))
    ) {
      return {
        key,
        alias: key,
        rol_dashboard: 'nivel',
        valor: numericValue,
      };
    }
  }

  return null;
}

function buildDerivedNivelFreatico({ variables, pozoConfig, rawData }) {
  const source = variables.find((variable) =>
    variable.ok &&
    variable.transformacion !== 'nivel_freatico' &&
    Number.isFinite(Number(variable.valor)) &&
    isLevelSensorVariable(variable)
  ) || findRawLevelSensor(rawData);

  if (!source) return null;

  const derived = {
    id: 'derived:nivel_freatico',
    key: 'nivel_freatico',
    alias: 'Nivel freatico',
    rol_dashboard: 'nivel_freatico',
    transformacion: 'derivado_pozo',
    unidad: 'm',
    fuente: {
      variable: source.key,
      alias: source.alias,
      profundidad_sensor_m: pozoConfig?.profundidad_sensor_m ?? null,
      profundidad_pozo_m: pozoConfig?.profundidad_pozo_m ?? null,
    },
    crudo: {
      lectura_sensor_m: Number(source.valor),
    },
    derivado: true,
    ok: true,
    valor: null,
  };

  try {
    derived.valor = calcularNivelFreatico({
      lecturaPozo: requireFiniteNumber(Number(source.valor), source.alias || source.key),
      profundidadSensor: numberOrNull(pozoConfig?.profundidad_sensor_m),
      profundidadTotal: requireFiniteNumber(pozoConfig?.profundidad_pozo_m, 'profundidad_pozo_m'),
    });
  } catch (err) {
    derived.ok = false;
    derived.error = err.message;
  }

  return derived;
}

function buildDashboardVariablesForRaw({ site, mappings, pozoConfig, rawData, telemetryError = null }) {
  const variables = [];

  for (const mapping of mappings) {
    const rawD1 = readRawValue(rawData, mapping.d1);
    const rawD2 = readRawValue(rawData, mapping.d2);
    const transformacion = normalizeTransform(mapping.transformacion);
    const isNivelFreaticoTransform = transformacion === 'nivel_freatico';
    const variable = {
      id: mapping.id,
      key: isNivelFreaticoTransform ? 'nivel_freatico' : responseKeyForMapping(mapping),
      alias: mapping.alias,
      rol_dashboard: isNivelFreaticoTransform ? 'nivel_freatico' : (mapping.rol_dashboard || 'generico'),
      transformacion,
      unidad: mapping.unidad || null,
      fuente: {
        d1: mapping.d1,
        d2: mapping.d2 || null,
      },
      crudo: {
        d1: rawD1 ?? null,
        d2: rawD2 ?? null,
      },
      ok: true,
      valor: null,
    };

    try {
      if (telemetryError) {
        throw new Error(telemetryError);
      }

      variable.valor = applyMappingTransform({ rawData, mapping, pozoConfig });
    } catch (err) {
      variable.ok = false;
      variable.error = err.message;
    }

    variables.push(variable);
  }

  const alreadyHasNivelFreatico = variables.some((variable) =>
    variable.key === 'nivel_freatico' || variable.transformacion === 'nivel_freatico'
  );

  if (site.tipo_sitio === 'pozo' && !alreadyHasNivelFreatico && !telemetryError) {
    const nivelFreatico = buildDerivedNivelFreatico({ variables, pozoConfig, rawData });

    if (nivelFreatico) {
      variables.push(nivelFreatico);
    }
  }

  return variables;
}

function buildResumen(variables) {
  const resumen = {};

  for (const variable of variables) {
    const role = dashboardRoleForVariable(variable);
    if (role === 'generico') continue;

    resumen[role] = {
      ok: variable.ok,
      valor: variable.valor,
      unidad: variable.unidad,
      alias: variable.alias,
      error: variable.error || null,
    };

    if (role === 'nivel_freatico' && variable.fuente?.variable) {
      resumen[role].fuente = variable.fuente.variable;
    }
  }

  return resumen;
}

function buildSiteDashboardData({ site, pozoConfig, mappings, latest }) {
  const rawData = latest?.data || {};
  const variables = buildDashboardVariablesForRaw({
    site,
    mappings,
    pozoConfig,
    rawData,
    telemetryError: latest ? null : `No hay telemetria para el serial ${site.id_serial}`,
  });

  return {
    site: {
      id: site.id,
      descripcion: site.descripcion,
      id_serial: site.id_serial,
      tipo_sitio: site.tipo_sitio,
    },
    pozo_config: pozoConfig,
    ultima_lectura: latest
      ? {
          time: latest.time,
          timestamp_completo: latest.timestamp_completo,
          id_serial: latest.id_serial,
        }
      : null,
    resumen: buildResumen(variables),
    variables,
  };
}

function findHistoricalVariable(variables, role) {
  const roleTokens = {
    caudal: ['caudal', 'flujo', 'flow'],
    totalizador: ['totalizador', 'totalizado', 'acumulado', 'volumen', 'volume', 'totalizer'],
    nivel_freatico: ['nivel freatico', 'freatico'],
  };
  const tokens = roleTokens[role] || [normalizeSearchText(role)];

  return variables.find((variable) => {
    if (role === 'nivel_freatico') {
      const text = normalizeSearchText(
        variable.key,
        variable.alias,
        variable.rol_dashboard,
        variable.transformacion
      );
      return text.includes('nivel freatico');
    }

    if (variable.rol_dashboard === role || variable.key === role) {
      return true;
    }

    const text = normalizeSearchText(
      variable.key,
      variable.alias,
      variable.rol_dashboard,
      variable.fuente?.d1,
      variable.fuente?.d2
    );
    return tokens.some((token) => text.includes(token));
  }) || null;
}

function serializeHistoricalVariable(variable) {
  if (!variable) {
    return {
      ok: false,
      valor: null,
      unidad: null,
      alias: null,
    };
  }

  return {
    ok: variable.ok !== false,
    valor: variable.ok === false ? null : variable.valor,
    unidad: variable.unidad || null,
    alias: variable.alias || null,
    error: variable.error || null,
  };
}

function mapHistoricalDashboardRow({ row, site, mappings, pozoConfig }) {
  const rawData = row?.data || {};
  const variables = buildDashboardVariablesForRaw({ site, mappings, pozoConfig, rawData });

  return {
    timestamp: row.time,
    fecha: row.timestamp_completo,
    caudal: serializeHistoricalVariable(findHistoricalVariable(variables, 'caudal')),
    totalizador: serializeHistoricalVariable(findHistoricalVariable(variables, 'totalizador')),
    nivel_freatico: serializeHistoricalVariable(findHistoricalVariable(variables, 'nivel_freatico')),
  };
}

module.exports = {
  buildSiteDashboardData,
  mapHistoricalDashboardRow,
};
