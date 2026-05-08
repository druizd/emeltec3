/**
 * Conversion IEEE 754 de 32 bits (4 bytes) a punto flotante.
 * Soporta los ordenes de bytes mas comunes en Modbus industrial:
 *   BE     = Big-Endian         ABCD
 *   LE     = Little-Endian      DCBA
 *   MID-BE = Mid Big-Endian     CDAB
 *   MID-LE = Mid Little-Endian  BADC
 */

const BYTE_ORDER_MAP = {
  BE: [0, 1, 2, 3],
  LE: [3, 2, 1, 0],
  'MID-BE': [2, 3, 0, 1],
  'MID-LE': [1, 0, 3, 2],
};

/**
 * Normaliza cualquier representacion de bytes al formato number[].
 * Acepta: string hexadecimal ("0x4148F5C3" o "4148F5C3"), Buffer de Node o array de enteros.
 */
function normalizeToBytes(input) {
  if (typeof input === 'string') {
    const clean = input.replace(/^0x/i, '').replace(/\s+/g, '');
    if (!/^[0-9a-f]*$/i.test(clean)) {
      throw new Error('El hex contiene caracteres invalidos');
    }
    if (clean.length % 2 !== 0) {
      throw new Error('El hex debe tener un numero par de caracteres');
    }

    const bytes = [];
    for (let i = 0; i < clean.length; i += 2) {
      bytes.push(parseInt(clean.slice(i, i + 2), 16));
    }
    return bytes;
  }

  if (Buffer.isBuffer(input)) {
    return Array.from(input);
  }

  if (Array.isArray(input)) {
    return input.map(Number);
  }

  throw new Error('Formato invalido. Use hex string, Buffer o array de bytes');
}

/**
 * Reordena 4 bytes segun el mapa de endianness.
 * Los indices en BYTE_ORDER_MAP indican desde que posicion del array original
 * tomar cada byte de salida.
 */
function reorderBytes(bytes, order) {
  const indices = BYTE_ORDER_MAP[order];
  if (!indices) {
    throw new Error(
      `Orden de bytes invalido: "${order}". Opciones validas: ${Object.keys(BYTE_ORDER_MAP).join(', ')}`
    );
  }

  return indices.map((i) => bytes[i]);
}

function bytesToFloat32(rawBytes, byteOrder = 'BE') {
  if (rawBytes.length < 4) {
    throw new Error(`Se necesitan 4 bytes para float32, se recibieron ${rawBytes.length}`);
  }

  const ordered = reorderBytes(rawBytes.slice(0, 4), byteOrder);
  const buf = Buffer.from(ordered);
  return buf.readFloatBE(0);
}

function bytesToInt32(rawBytes, byteOrder = 'BE', signed = true) {
  if (rawBytes.length < 4) {
    throw new Error(`Se necesitan 4 bytes para int32, se recibieron ${rawBytes.length}`);
  }

  const ordered = reorderBytes(rawBytes.slice(0, 4), byteOrder);
  const buf = Buffer.from(ordered);
  return signed ? buf.readInt32BE(0) : buf.readUInt32BE(0);
}

function bytesToInt16(rawBytes, byteOrder = 'BE', signed = true) {
  if (rawBytes.length < 2) {
    throw new Error(`Se necesitan 2 bytes para int16, se recibieron ${rawBytes.length}`);
  }

  const indices = byteOrder === 'LE' ? [1, 0] : [0, 1];
  const ordered = indices.map((i) => rawBytes[i]);
  const buf = Buffer.from(ordered);
  return signed ? buf.readInt16BE(0) : buf.readUInt16BE(0);
}

function float32ToBytes(value, byteOrder = 'BE') {
  const buf = Buffer.allocUnsafe(4);
  buf.writeFloatBE(value, 0);
  const bytes = Array.from(buf);
  const indices = BYTE_ORDER_MAP[byteOrder];
  if (!indices) {
    throw new Error(`Orden invalido: ${byteOrder}`);
  }

  return indices.map((i) => bytes[i]);
}

function float32ToHex(value, byteOrder = 'BE') {
  return float32ToBytes(value, byteOrder)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Punto de entrada principal para hex / bytes raw.
 *
 * @param {string|number[]|Buffer} input - Hex, array de bytes o Buffer.
 * @param {object} opts
 * @param {'float32'|'int32'|'uint32'|'int16'|'uint16'} opts.formato
 * @param {'BE'|'LE'|'MID-BE'|'MID-LE'} opts.byteOrder
 * @returns {number}
 */
function parseIEEE754(input, { formato = 'float32', byteOrder = 'BE' } = {}) {
  const bytes = normalizeToBytes(input);

  switch (formato) {
    case 'float32':
      return bytesToFloat32(bytes, byteOrder);
    case 'int32':
      return bytesToInt32(bytes, byteOrder, true);
    case 'uint32':
      return bytesToInt32(bytes, byteOrder, false);
    case 'int16':
      return bytesToInt16(bytes, byteOrder, true);
    case 'uint16':
      return bytesToInt16(bytes, byteOrder, false);
    default:
      throw new Error(`Formato invalido: "${formato}". Use float32, int32, uint32, int16 o uint16`);
  }
}

/**
 * Convierte dos valores de 16 bits a Float32 IEEE 754.
 *
 * Un Float32 ocupa 32 bits divididos en dos words de 16 bits:
 *   wordAlta = los 16 bits mas significativos
 *   wordBaja = los 16 bits menos significativos
 *
 * wordSwap controla cual word va primero en el buffer de 4 bytes:
 *   false: wordAlta primero (Big-Endian estandar, ABCD)
 *   true: wordBaja primero (Word Swap, CDAB)
 *
 * @param {number} wordAlta - Primer valor de 16 bits (0-65535).
 * @param {number} wordBaja - Segundo valor de 16 bits (0-65535).
 * @param {boolean} wordSwap - Intercambio de palabras.
 * @returns {{valor: number, hex: string, word_swap: boolean, detalle: object}}
 */
function registrosModbusAFloat32(wordAlta, wordBaja, wordSwap = false) {
  if (!Number.isInteger(wordAlta) || wordAlta < 0 || wordAlta > 65535) {
    throw new Error('El primer valor debe ser un entero entre 0 y 65535');
  }
  if (!Number.isInteger(wordBaja) || wordBaja < 0 || wordBaja > 65535) {
    throw new Error('El segundo valor debe ser un entero entre 0 y 65535');
  }

  const bufAlto = Buffer.allocUnsafe(2);
  const bufBajo = Buffer.allocUnsafe(2);
  bufAlto.writeUInt16BE(wordAlta, 0);
  bufBajo.writeUInt16BE(wordBaja, 0);

  const combined = wordSwap
    ? Buffer.concat([bufBajo, bufAlto])
    : Buffer.concat([bufAlto, bufBajo]);

  const valor = combined.readFloatBE(0);

  const hexAlto = bufAlto.toString('hex');
  const hexBajo = bufBajo.toString('hex');
  const hexCombinado = combined.toString('hex');

  const bits = combined.readUInt32BE(0);
  const signo = (bits >>> 31) & 0x1;
  const exponente = (bits >>> 23) & 0xff;
  const mantisa = bits & 0x7fffff;

  return {
    valor,
    hex: hexCombinado,
    word_swap: wordSwap,
    detalle: {
      word_alta: { decimal: wordAlta, hex: `0x${hexAlto.toUpperCase()}` },
      word_baja: { decimal: wordBaja, hex: `0x${hexBajo.toUpperCase()}` },
      hex_combinado: `0x${hexCombinado.toUpperCase()}`,
      ieee754: {
        signo,
        exponente_raw: exponente,
        exponente_real: exponente - 127,
        mantisa_hex: `0x${mantisa.toString(16).padStart(6, '0').toUpperCase()}`,
      },
    },
  };
}

/**
 * Convierte dos registros Modbus de 16 bits a un entero unsigned de 32 bits.
 *
 * Formula:
 *   (registroAlto * 65536) + registroBajo
 *
 * wordSwap permite invertir el orden cuando el equipo envia primero la word baja:
 *   false: d1 = registroAlto, d2 = registroBajo
 *   true:  d2 = registroAlto, d1 = registroBajo
 */
function registrosModbusAUInt32(wordAlta, wordBaja, wordSwap = false) {
  if (!Number.isInteger(wordAlta) || wordAlta < 0 || wordAlta > 65535) {
    throw new Error('El primer valor debe ser un entero entre 0 y 65535');
  }
  if (!Number.isInteger(wordBaja) || wordBaja < 0 || wordBaja > 65535) {
    throw new Error('El segundo valor debe ser un entero entre 0 y 65535');
  }

  const registroAlto = wordSwap ? wordBaja : wordAlta;
  const registroBajo = wordSwap ? wordAlta : wordBaja;

  return {
    valor: (registroAlto * 65536) + registroBajo,
    word_swap: wordSwap,
    detalle: {
      registro_alto: registroAlto,
      registro_bajo: registroBajo,
      formula: `(${registroAlto} * 65536) + ${registroBajo}`,
    },
  };
}

module.exports = {
  parseIEEE754,
  registrosModbusAFloat32,
  registrosModbusAUInt32,
  bytesToFloat32,
  bytesToInt32,
  bytesToInt16,
  float32ToBytes,
  float32ToHex,
  normalizeToBytes,
  BYTE_ORDER_MAP,
};
