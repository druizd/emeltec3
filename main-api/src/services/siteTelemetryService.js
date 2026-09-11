const { calcularNivelFreatico } = require('../utils/nivelFreatico');
const { VARIABLE_TRANSFORM_IDS } = require('../config/siteTypeCatalog');
// Fuente única de la matemática de transformación (CommonJS, resuelve en dev
// src/, dist/ y vitest sin ambigüedad de extensión).
const { applyMappingTransform, parseMappingParams } = require('../utils/mappingTransform.js');

const VARIABLE_TRANSFORMS = new Set(VARIABLE_TRANSFORM_IDS);

function cleanString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toUtcIsoString(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) {
    return value;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
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

function responseKeyForMapping(mapping) {
  if (mapping.rol_dashboard && mapping.rol_dashboard !== 'generico') return mapping.rol_dashboard;
  return (
    cleanString(mapping.alias)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || mapping.d1
  );
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
      (text.includes('nivel') ||
        text.includes('level') ||
        text.includes('sonda') ||
        text.includes('altura agua'))
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
  const source =
    variables.find(
      (variable) =>
        variable.ok &&
        variable.transformacion !== 'nivel_freatico' &&
        Number.isFinite(Number(variable.valor)) &&
        isLevelSensorVariable(variable),
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

function buildDashboardVariablesForRaw({
  site,
  mappings,
  pozoConfig,
  rawData,
  telemetryError = null,
}) {
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
      rol_dashboard: isNivelFreaticoTransform
        ? 'nivel_freatico'
        : mapping.rol_dashboard || 'generico',
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

  const alreadyHasNivelFreatico = variables.some(
    (variable) => variable.key === 'nivel_freatico' || variable.transformacion === 'nivel_freatico',
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
    // Mismo criterio que findHistoricalVariable: un mapeo roto no pisa al que
    // ya calculó para ese rol. Sin esto el resumen dependía del ORDER BY alias.
    if (resumen[role]?.ok && variable.ok === false) continue;

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
    server_time: toUtcIsoString(new Date()),
    site: {
      id: site.id,
      descripcion: site.descripcion,
      id_serial: site.id_serial,
      tipo_sitio: site.tipo_sitio,
    },
    pozo_config: pozoConfig,
    ultima_lectura: latest
      ? {
          time: toUtcIsoString(latest.time),
          timestamp_completo: toUtcIsoString(latest.time),
          received_at: toUtcIsoString(latest.received_at),
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
    nivel: ['nivel agua', 'nivel', 'level', 'sonda', 'altura agua'],
    totalizador: ['totalizador', 'totalizado', 'acumulado', 'volumen', 'volume', 'totalizer'],
    nivel_freatico: ['nivel freatico', 'freatico'],
  };
  const tokens = roleTokens[role] || [normalizeSearchText(role)];

  let best = null;
  let bestScore = 0;

  for (const variable of variables) {
    let score = 0;

    if (role === 'nivel_freatico') {
      const text = normalizeSearchText(
        variable.key,
        variable.alias,
        variable.rol_dashboard,
        variable.transformacion,
      );
      score = text.includes('nivel freatico') ? 80 : 0;
    } else {
      const text = normalizeSearchText(
        variable.key,
        variable.alias,
        variable.rol_dashboard,
        variable.fuente?.d1,
        variable.fuente?.d2,
      );
      if (role === 'nivel' && text.includes('freatico')) continue;
      const matchesText = tokens.some((token) => text.includes(token));
      const isUInt32Totalizer =
        role === 'totalizador' && ['uint32_registros', 'uint32'].includes(variable.transformacion);

      if (
        isUInt32Totalizer &&
        (variable.rol_dashboard === role || variable.key === role || matchesText)
      ) {
        score = 110;
      } else if (variable.rol_dashboard === role) {
        score = 90;
      } else if (variable.key === role) {
        score = 70;
      } else if (matchesText) {
        score = 30;
      }
    }

    if (score === 0) continue;

    // Entre candidatos al rol, la variable que sí calculó le gana a la rota
    // aunque puntúe menos. Dos mapeos con el mismo rol son el resto típico de
    // un recambio de equipo (el registro viejo ya no llega) y el bono del
    // totalizador uint32 (110 vs 90 del rol) no puede premiar a un mapeo que
    // está fallando: eso dejó a S128 declarando acumulado null a DGA el
    // 04-09-2026. A igual salud manda el puntaje y, a igual puntaje, el orden.
    const bestRoto = best !== null && best.ok === false;
    const variableRota = variable.ok === false;
    const gana =
      best === null ||
      (bestRoto && !variableRota) ||
      (bestRoto === variableRota && score > bestScore);

    if (gana) {
      best = variable;
      bestScore = score;
    }
  }

  return best;
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

/**
 * Los mapeos de bits del sitio, ordenados por dato original y número de bit.
 *
 * Las señales digitales NO pasan por `findHistoricalVariable`: esa función
 * asigna UN mapping por rol con búsqueda difusa de tokens, y acá son N señales
 * sin rol (una palabra de entradas digitales las tiene todas en `generico`).
 * Se resuelven por transformación, que es exacta.
 */
function digitalMappings(mappings) {
  return (mappings || [])
    .filter((mapping) => normalizeTransform(mapping.transformacion) === 'bit')
    .map((mapping) => ({
      mapping,
      key: responseKeyForMapping(mapping),
      alias: mapping.alias || mapping.d1,
      bit: numberOrNull(parseMappingParams(mapping.parametros).bit) ?? 0,
    }))
    .sort((a, b) => a.mapping.d1.localeCompare(b.mapping.d1, 'es-CL') || a.bit - b.bit);
}

/**
 * Serializa las señales digitales de UNA fila cruda.
 *
 * Se calculan aparte de los roles históricos porque son por sitio y variables
 * en número: un objeto `{ clave: {ok, valor, alias, bit} }` deja el shape de la
 * fila estable aunque el sitio tenga 0 o 32 señales. `valor` es 1/0, nunca
 * booleano — lo mismo que devuelve el dashboard en vivo.
 */
function serializeDigitalRow(digitales, rawData, telemetryError = null) {
  const out = {};

  for (const entry of digitales) {
    try {
      if (telemetryError) throw new Error(telemetryError);
      out[entry.key] = {
        ok: true,
        valor: applyMappingTransform({ rawData, mapping: entry.mapping }),
        alias: entry.alias,
        bit: entry.bit,
        error: null,
      };
    } catch (err) {
      out[entry.key] = {
        ok: false,
        valor: null,
        alias: entry.alias,
        bit: entry.bit,
        error: err.message,
      };
    }
  }

  return out;
}

function mapHistoricalDashboardRow({ row, site, mappings, pozoConfig }) {
  const rawData = row?.data || {};
  const variables = buildDashboardVariablesForRaw({ site, mappings, pozoConfig, rawData });

  return {
    timestamp: toUtcIsoString(row.time),
    fecha: toUtcIsoString(row.time),
    received_at: toUtcIsoString(row.received_at),
    caudal: serializeHistoricalVariable(findHistoricalVariable(variables, 'caudal')),
    nivel: serializeHistoricalVariable(findHistoricalVariable(variables, 'nivel')),
    totalizador: serializeHistoricalVariable(findHistoricalVariable(variables, 'totalizador')),
    nivel_freatico: serializeHistoricalVariable(
      findHistoricalVariable(variables, 'nivel_freatico'),
    ),
    digitales: serializeDigitalRow(digitalMappings(mappings), rawData),
  };
}

const HISTORICAL_ROLES = ['caudal', 'nivel', 'totalizador', 'nivel_freatico'];

/**
 * Crea un mapper optimizado para procesar muchas filas históricas del mismo
 * sitio. Resuelve la asignación rol→mapping UNA SOLA VEZ usando una fila de
 * muestra (sampleRawData), luego cada fila ejecuta máximo 4
 * `applyMappingTransform` (uno por rol relevante) en lugar de iterar todos
 * los mappings + búsqueda fuzzy de roles. Para una vista con 2200 filas y 8
 * mappings: ahorra ~17k iteraciones + 17k búsquedas de tokens.
 *
 * IMPORTANTE: `sampleRawData` debe ser de una fila real (típicamente la
 * primera). Construir el skeleton con rawData vacío rompe la detección del
 * nivel_freatico derivado (`buildDerivedNivelFreatico` filtra source por
 * `Number.isFinite(Number(variable.valor))` — con rawData vacío todos los
 * valores son null y el derived se devuelve como inexistente).
 *
 * Equivalencia funcional con llamar `mapHistoricalDashboardRow` por fila.
 */
function createHistoricalRowMapper({ site, mappings, pozoConfig, sampleRawData = {} }) {
  const skeleton = buildDashboardVariablesForRaw({
    site,
    mappings,
    pozoConfig,
    rawData: sampleRawData,
  });

  // Las señales digitales se resuelven una sola vez, igual que los roles: por
  // fila queda solo la aritmética del bit dentro de applyMappingTransform.
  const digitales = digitalMappings(mappings);

  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const mappingByKey = new Map(
    mappings.map((mapping) => [responseKeyForMapping(mapping), mapping]),
  );

  // Resuelve cada rol histórico a uno de:
  //  - { kind: 'mapping', mapping, alias, unidad }: transforma rawData con un mapping directo
  //  - { kind: 'derived_nivel_freatico', sourceMapping, alias, unidad }: deriva via calcularNivelFreatico usando un mapping fuente + pozoConfig
  //  - null: rol no presente en este sitio
  const resolved = {};
  for (const role of HISTORICAL_ROLES) {
    const variable = findHistoricalVariable(skeleton, role);
    if (!variable) {
      resolved[role] = null;
      continue;
    }

    if (variable.derivado && role === 'nivel_freatico') {
      const sourceMapping = mappingByKey.get(variable.fuente?.variable);
      resolved[role] = sourceMapping
        ? {
            kind: 'derived_nivel_freatico',
            sourceMapping,
            alias: variable.alias,
            unidad: variable.unidad || 'm',
          }
        : null;
      continue;
    }

    const mapping = mappingById.get(variable.id);
    resolved[role] = mapping
      ? {
          kind: 'mapping',
          mapping,
          alias: variable.alias,
          unidad: variable.unidad || mapping.unidad || null,
        }
      : null;
  }

  return function mapRow(row) {
    const rawData = row?.data || {};
    const out = {
      timestamp: toUtcIsoString(row.time),
      fecha: toUtcIsoString(row.time),
      received_at: toUtcIsoString(row.received_at),
    };

    out.digitales = serializeDigitalRow(digitales, rawData);

    for (const role of HISTORICAL_ROLES) {
      const r = resolved[role];
      if (!r) {
        out[role] = serializeHistoricalVariable(null);
        continue;
      }

      try {
        let valor;
        if (r.kind === 'mapping') {
          valor = applyMappingTransform({ rawData, mapping: r.mapping, pozoConfig });
        } else {
          const lecturaPozo = requireFiniteNumber(
            Number(applyMappingTransform({ rawData, mapping: r.sourceMapping, pozoConfig })),
            r.sourceMapping.alias || r.sourceMapping.id,
          );
          valor = calcularNivelFreatico({
            lecturaPozo,
            profundidadSensor: numberOrNull(pozoConfig?.profundidad_sensor_m),
            profundidadTotal: requireFiniteNumber(
              pozoConfig?.profundidad_pozo_m,
              'profundidad_pozo_m',
            ),
          });
        }
        out[role] = {
          ok: true,
          valor,
          unidad: r.unidad || null,
          alias: r.alias || null,
          error: null,
        };
      } catch (err) {
        out[role] = {
          ok: false,
          valor: null,
          unidad: r.unidad || null,
          alias: r.alias || null,
          error: err.message,
        };
      }
    }

    return out;
  };
}

module.exports = {
  buildSiteDashboardData,
  mapHistoricalDashboardRow,
  createHistoricalRowMapper,
  digitalMappings,
  serializeDigitalRow,
};
