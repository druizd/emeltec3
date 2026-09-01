/**
 * Fuente ÚNICA de la matemática de transformación de variables (IEEE754,
 * lineal, uint32, nivel freático, caudal).
 *
 * CommonJS puro para que lo consuman tanto los módulos TS
 * (`modules/sites/transforms.ts` re-exporta con tipos) como los servicios JS
 * (`services/siteTelemetryService.js`). Antes esta lógica estaba DUPLICADA en
 * ambos lados y había que mantener las dos copias sincronizadas a mano.
 */
const { parseIEEE754, registrosModbusAFloat32, registrosModbusAUInt32 } = require('./ieee754.js');
const { m3hALs } = require('./caudal.js');
const { calcularNivelFreatico } = require('./nivelFreatico.js');

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requireFiniteNumber(value, label) {
  const n = numberOrNull(value);
  if (n === null) throw new Error(`${label} debe ser numerico`);
  return n;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function normalizeTransform(value) {
  const raw = String(value ?? 'directo')
    .trim()
    .toLowerCase();
  if (raw === 'escala_lineal') return 'lineal';
  if (raw === 'ieee754') return 'ieee754_32';
  if (raw === 'caudal') return 'caudal_m3h_lps';
  if (raw === 'uint32') return 'uint32_registros';
  return raw;
}

function parseMappingParams(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Anchos de registro soportados para el complemento a 2. */
const SIGNED_BITS = new Set([8, 16, 32]);

/**
 * Reinterpreta un entero sin signo como complemento a 2 del ancho indicado.
 * Un registro Modbus de 16 bits no puede llevar el signo, asi que el PLC manda
 * -449 como 65087 (65536 - 449). Todo lo que pase de la mitad del rango es
 * negativo.
 */
function applySignedWrap(value, bits) {
  const modulo = 2 ** bits;
  if (value < 0 || value >= modulo) {
    // Fuera del rango sin signo el ancho configurado no corresponde. Fallar es
    // preferible a devolver un numero plausible pero equivocado: el dashboard
    // muestra el error y el dato no entra a contadores ni a DGA.
    throw new Error(`${value} no cabe en un registro sin signo de ${bits} bits`);
  }
  return value >= modulo / 2 ? value - modulo : value;
}

/**
 * Devuelve el crudo ya reinterpretado con signo si `con_signo` esta activo.
 * `signo_bits` defaultea al ancho natural de la transformacion (16 para un
 * registro suelto, 32 para el par combinado).
 */
function applySignedParam(value, params, defaultBits) {
  if (!parseBooleanParam(params.con_signo, false)) return value;
  const bits = numberOrNull(params.signo_bits) ?? defaultBits;
  return applySignedWrap(
    requireFiniteNumber(value, 'valor'),
    SIGNED_BITS.has(bits) ? bits : defaultBits,
  );
}

function applyLinearTransform(value, params = {}) {
  const base = requireFiniteNumber(value, 'valor');
  const factor = numberOrNull(params.factor) ?? 1;
  const offset = numberOrNull(params.offset) ?? 0;
  return base * factor + offset;
}

/** Devuelve el valor transformado o lanza Error si la transformación no aplica. */
function applyMappingTransform({ rawData, mapping, pozoConfig }) {
  const params = parseMappingParams(mapping.parametros);
  const transform = normalizeTransform(mapping.transformacion);
  const rawD1 = readRawValue(rawData, mapping.d1);

  switch (transform) {
    case 'directo':
      return rawD1;

    case 'lineal':
      return applyLinearTransform(applySignedParam(rawD1, params, 16), params);

    case 'lineal_int16': {
      const raw = requireFiniteNumber(rawD1, mapping.d1);
      return applyLinearTransform(applySignedWrap(raw, 16), params);
    }

    case 'ieee754_32': {
      // Decodifica el float32 y luego aplica factor + offset (igual que
      // uint32_registros). factor defaultea a 1 y offset a 0 → retrocompatible
      // con configs que no guardaban estos parámetros.
      let decoded;
      if (mapping.d2) {
        const high = requireFiniteNumber(rawD1, mapping.d1);
        const low = requireFiniteNumber(readRawValue(rawData, mapping.d2), mapping.d2);
        const wordSwap = parseBooleanParam(params.word_swap ?? params.wordSwap, false);
        decoded = registrosModbusAFloat32(high, low, wordSwap).valor;
      } else {
        if (rawD1 === undefined || rawD1 === null) {
          throw new Error(`No existe dato crudo ${mapping.d1}`);
        }
        decoded = parseIEEE754(rawD1, {
          formato: params.formato || 'float32',
          byteOrder: params.byteOrder || params.word_order || 'BE',
        });
      }
      return applyLinearTransform(decoded, params);
    }

    case 'uint32_registros': {
      const high = requireFiniteNumber(rawD1, mapping.d1);
      const low = requireFiniteNumber(readRawValue(rawData, mapping.d2), mapping.d2 || 'd2');
      const wordSwap = parseBooleanParam(params.word_swap ?? params.wordSwap, false);
      const combinado = registrosModbusAUInt32(high, low, wordSwap).valor;
      // Aplica factor + offset al uint32 combinado para permitir decimales
      // (ej. factor=0.01 corre 2 decimales). factor defaultea a 1 →
      // retrocompatible con configs que solo guardaban offset.
      return applyLinearTransform(applySignedParam(combinado, params, 32), params);
    }

    case 'nivel_freatico': {
      const lecturaPozo = applyLinearTransform(applySignedParam(rawD1, params, 16), params);
      return calcularNivelFreatico({
        lecturaPozo,
        profundidadSensor: numberOrNull(pozoConfig?.profundidad_sensor_m),
        profundidadTotal: requireFiniteNumber(pozoConfig?.profundidad_pozo_m, 'profundidad_pozo_m'),
      });
    }

    case 'caudal_m3h_lps': {
      const caudalM3h = applyLinearTransform(applySignedParam(rawD1, params, 16), params);
      return m3hALs(caudalM3h);
    }

    case 'formula':
      throw new Error('transformacion formula aun no esta habilitada en dashboard-data');

    default:
      throw new Error(`transformacion no soportada: ${transform}`);
  }
}

module.exports = {
  applyMappingTransform,
  applyLinearTransform,
  applySignedWrap,
  normalizeTransform,
  parseMappingParams,
  readRawValue,
  numberOrNull,
  isPlainObject,
};
