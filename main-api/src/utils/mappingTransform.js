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

/** Anchos de palabra soportados para separar bits. */
const WORD_BITS = new Set([16, 32]);

/**
 * Extrae UN bit de una palabra de registros, donde cada bit es una senal
 * digital independiente (marcha, falla, limite de carrera). La palabra se
 * configura como N variables que comparten `d1` y difieren en
 * `parametros.bit`; el bit 0 es el menos significativo.
 *
 * Devuelve 1/0 numerico y NO un boolean a proposito: contadores, alertas y el
 * export CSV hacen Number() sobre el valor y un boolean se les cuela como NaN.
 * Las etiquetas ("Marcha"/"Detenido") son presentacion y viven en el frontend.
 *
 * `invertido` es para las senales activas en 0 (un termico sano suele leer 1).
 */
function applyBitExtraction(value, params) {
  const declarado = numberOrNull(params.palabra_bits);
  const bits = WORD_BITS.has(declarado) ? declarado : 16;

  const bit = numberOrNull(params.bit);
  if (bit === null || !Number.isInteger(bit) || bit < 0 || bit >= bits) {
    throw new Error(`bit ${params.bit} fuera de rango para una palabra de ${bits} bits`);
  }

  const raw = requireFiniteNumber(value, 'valor');
  if (!Number.isInteger(raw) || raw < 0 || raw >= 2 ** bits) {
    // Mismo criterio que applySignedWrap: un ancho mal elegido no falla solo.
    // Los bits bajos seguirian dando 0/1 plausibles mientras los altos se
    // pierden en silencio, y eso termina en un historico de senales inventado.
    throw new Error(`${raw} no es una palabra sin signo de ${bits} bits`);
  }

  // Division en vez de `>>>` para no depender de la coercion a int32 de JS.
  const encendido = Math.floor(raw / 2 ** bit) % 2 === 1;
  return (parseBooleanParam(params.invertido, false) ? !encendido : encendido) ? 1 : 0;
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

/**
 * Cut-off de caudal bajo — el mismo concepto que trae el propio caudalímetro
 * (en el SITRANS FMT020 vive en el menú 2.2.2.5).
 *
 * Un electromagnético en reposo no marca cero: oscila alrededor de cero por
 * deriva del punto de cero. En S128, con la bomba parada, esa deriva llega a
 * ±0,066 L/s contra un caudal de trabajo de 14,3 L/s. Los negativos no son
 * flujo inverso y los positivos diminutos no son extracción: los dos son ruido.
 *
 * Por eso el corte es SIMÉTRICO sobre el valor absoluto. Cortar solo los
 * negativos dejaría la serie sesgada hacia arriba — el promedio en reposo daría
 * positivo en vez de cero, que es justo lo que no queremos declarar a la DGA.
 *
 * Se aplica AL LEER, nunca al guardar: el crudo de `equipo` queda intacto y
 * borrar el parámetro devuelve la serie original. Lo único que queda
 * materializado es lo que ya escribieron el fill del DGA y los contadores.
 *
 * Opt-in por variable: sin `cut_off` en `parametros` esto es un no-op.
 */
function applyCutOff(value, params = {}) {
  const cutOff = numberOrNull(params.cut_off);
  if (cutOff === null || !(cutOff > 0)) return value;
  // Las transformaciones de bit devuelven etiquetas de texto y `directo`
  // devuelve el crudo sin tocar: solo recortamos números reales.
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return Math.abs(value) < cutOff ? 0 : value;
}

/** Devuelve el valor transformado o lanza Error si la transformación no aplica. */
function computeMappingValue({ rawData, mapping, pozoConfig }) {
  const params = parseMappingParams(mapping.parametros);
  const transform = normalizeTransform(mapping.transformacion);
  const rawD1 = readRawValue(rawData, mapping.d1);

  switch (transform) {
    case 'directo':
      return rawD1;

    case 'bit':
      return applyBitExtraction(rawD1, params);

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

/**
 * Punto de entrada público: transforma y luego aplica el cut-off si la variable
 * lo tiene configurado. Todo el resto del backend pasa por acá — el histórico
 * HTTP (`services/siteTelemetryService.js`), el fill del DGA, los contadores y
 * las alertas — así que el cut-off vale para los cuatro sin tocar nada más.
 */
function applyMappingTransform({ rawData, mapping, pozoConfig }) {
  const params = parseMappingParams(mapping.parametros);
  return applyCutOff(computeMappingValue({ rawData, mapping, pozoConfig }), params);
}

module.exports = {
  applyMappingTransform,
  applyCutOff,
  applyLinearTransform,
  applySignedWrap,
  applyBitExtraction,
  normalizeTransform,
  parseMappingParams,
  readRawValue,
  numberOrNull,
  isPlainObject,
};
