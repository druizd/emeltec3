/**
 * Conversion IEEE 754 de 32 bits (4 bytes) a punto flotante.
 * Soporta los ordenes de bytes mas comunes en Modbus industrial:
 *   BE     = Big-Endian         ABCD
 *   LE     = Little-Endian      DCBA
 *   MID-BE = Mid Big-Endian     CDAB
 *   MID-LE = Mid Little-Endian  BADC
 */

export type ByteOrder = 'BE' | 'LE' | 'MID-BE' | 'MID-LE';
export type Formato = 'float32' | 'int32' | 'uint32' | 'int16' | 'uint16';

export const BYTE_ORDER_MAP: Record<ByteOrder, [number, number, number, number]> = {
  BE: [0, 1, 2, 3],
  LE: [3, 2, 1, 0],
  'MID-BE': [2, 3, 0, 1],
  'MID-LE': [1, 0, 3, 2],
};

export function normalizeToBytes(input: unknown): number[] {
  if (typeof input === 'string') {
    const clean = input.replace(/^0x/i, '').replace(/\s+/g, '');
    if (!/^[0-9a-f]*$/i.test(clean)) throw new Error('El hex contiene caracteres invalidos');
    if (clean.length % 2 !== 0) throw new Error('El hex debe tener un numero par de caracteres');
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
    return bytes;
  }
  if (Buffer.isBuffer(input)) return Array.from(input);
  if (Array.isArray(input)) return input.map(Number);
  throw new Error('Formato invalido. Use hex string, Buffer o array de bytes');
}

function reorderBytes(bytes: number[], order: ByteOrder): number[] {
  const indices = BYTE_ORDER_MAP[order];
  if (!indices) {
    throw new Error(
      `Orden de bytes invalido: "${order}". Opciones validas: ${Object.keys(BYTE_ORDER_MAP).join(', ')}`,
    );
  }
  return indices.map((i) => bytes[i] ?? 0);
}

export function bytesToFloat32(rawBytes: number[], byteOrder: ByteOrder = 'BE'): number {
  if (rawBytes.length < 4) {
    throw new Error(`Se necesitan 4 bytes para float32, se recibieron ${rawBytes.length}`);
  }
  const ordered = reorderBytes(rawBytes.slice(0, 4), byteOrder);
  return Buffer.from(ordered).readFloatBE(0);
}

export function bytesToInt32(
  rawBytes: number[],
  byteOrder: ByteOrder = 'BE',
  signed = true,
): number {
  if (rawBytes.length < 4) {
    throw new Error(`Se necesitan 4 bytes para int32, se recibieron ${rawBytes.length}`);
  }
  const ordered = reorderBytes(rawBytes.slice(0, 4), byteOrder);
  const buf = Buffer.from(ordered);
  return signed ? buf.readInt32BE(0) : buf.readUInt32BE(0);
}

export function bytesToInt16(
  rawBytes: number[],
  byteOrder: ByteOrder = 'BE',
  signed = true,
): number {
  if (rawBytes.length < 2) {
    throw new Error(`Se necesitan 2 bytes para int16, se recibieron ${rawBytes.length}`);
  }
  const indices = byteOrder === 'LE' ? [1, 0] : [0, 1];
  const ordered = indices.map((i) => rawBytes[i] ?? 0);
  const buf = Buffer.from(ordered);
  return signed ? buf.readInt16BE(0) : buf.readUInt16BE(0);
}

export function float32ToBytes(value: number, byteOrder: ByteOrder = 'BE'): number[] {
  const buf = Buffer.allocUnsafe(4);
  buf.writeFloatBE(value, 0);
  const bytes = Array.from(buf);
  const indices = BYTE_ORDER_MAP[byteOrder];
  if (!indices) throw new Error(`Orden invalido: ${byteOrder}`);
  return indices.map((i) => bytes[i] ?? 0);
}

export function float32ToHex(value: number, byteOrder: ByteOrder = 'BE'): string {
  return float32ToBytes(value, byteOrder)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ParseIEEEOpts {
  formato?: Formato;
  byteOrder?: ByteOrder;
}

export function parseIEEE754(input: unknown, opts: ParseIEEEOpts = {}): number {
  const formato = opts.formato ?? 'float32';
  const byteOrder = opts.byteOrder ?? 'BE';
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

export interface ModbusFloat32Result {
  valor: number;
  hex: string;
  word_swap: boolean;
  detalle: {
    word_alta: { decimal: number; hex: string };
    word_baja: { decimal: number; hex: string };
    hex_combinado: string;
    ieee754: {
      signo: number;
      exponente_raw: number;
      exponente_real: number;
      mantisa_hex: string;
    };
  };
}

export function registrosModbusAFloat32(
  wordAlta: number,
  wordBaja: number,
  wordSwap = false,
): ModbusFloat32Result {
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

  const combined = wordSwap ? Buffer.concat([bufBajo, bufAlto]) : Buffer.concat([bufAlto, bufBajo]);
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

export interface ModbusUInt32Result {
  valor: number;
  word_swap: boolean;
  detalle: { registro_alto: number; registro_bajo: number; formula: string };
}

export function registrosModbusAUInt32(
  wordAlta: number,
  wordBaja: number,
  wordSwap = false,
): ModbusUInt32Result {
  if (!Number.isInteger(wordAlta) || wordAlta < 0 || wordAlta > 65535) {
    throw new Error('El primer valor debe ser un entero entre 0 y 65535');
  }
  if (!Number.isInteger(wordBaja) || wordBaja < 0 || wordBaja > 65535) {
    throw new Error('El segundo valor debe ser un entero entre 0 y 65535');
  }
  const registroAlto = wordSwap ? wordBaja : wordAlta;
  const registroBajo = wordSwap ? wordAlta : wordBaja;
  return {
    valor: registroAlto * 65536 + registroBajo,
    word_swap: wordSwap,
    detalle: {
      registro_alto: registroAlto,
      registro_bajo: registroBajo,
      formula: `(${registroAlto} * 65536) + ${registroBajo}`,
    },
  };
}
