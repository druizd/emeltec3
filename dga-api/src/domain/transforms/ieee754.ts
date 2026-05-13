export type ByteOrder = 'BE' | 'LE' | 'MID-BE' | 'MID-LE';
export type NumericFormat = 'float32' | 'int32' | 'uint32' | 'int16' | 'uint16';

const BYTE_ORDER_MAP: Record<ByteOrder, [number, number, number, number]> = {
  BE: [0, 1, 2, 3],
  LE: [3, 2, 1, 0],
  'MID-BE': [2, 3, 0, 1],
  'MID-LE': [1, 0, 3, 2],
};

function normalizeToBytes(input: unknown): number[] {
  if (typeof input === 'string') {
    const clean = input.replace(/^0x/i, '').replace(/\s+/g, '');
    if (!/^[0-9a-f]*$/i.test(clean)) throw new Error('El hex contiene caracteres inválidos');
    if (clean.length % 2 !== 0) throw new Error('El hex debe tener un número par de caracteres');
    const bytes: number[] = [];
    for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
    return bytes;
  }
  if (Buffer.isBuffer(input)) return Array.from(input);
  if (Array.isArray(input)) return (input as unknown[]).map((v) => Number(v));
  throw new Error('Formato inválido. Use hex string, Buffer o array de bytes');
}

function reorderBytes(bytes: number[], order: ByteOrder): number[] {
  const indices = BYTE_ORDER_MAP[order];
  return indices.map((i) => bytes[i] ?? 0);
}

function bytesToFloat32(bytes: number[], order: ByteOrder = 'BE'): number {
  if (bytes.length < 4) throw new Error(`Se necesitan 4 bytes para float32, se recibieron ${bytes.length}`);
  return Buffer.from(reorderBytes(bytes.slice(0, 4), order)).readFloatBE(0);
}

function bytesToInt32(bytes: number[], order: ByteOrder = 'BE', signed = true): number {
  if (bytes.length < 4) throw new Error(`Se necesitan 4 bytes para int32, se recibieron ${bytes.length}`);
  const buf = Buffer.from(reorderBytes(bytes.slice(0, 4), order));
  return signed ? buf.readInt32BE(0) : buf.readUInt32BE(0);
}

function bytesToInt16(bytes: number[], order: ByteOrder = 'BE', signed = true): number {
  if (bytes.length < 2) throw new Error(`Se necesitan 2 bytes para int16, se recibieron ${bytes.length}`);
  const indices: [number, number] = order === 'LE' ? [1, 0] : [0, 1];
  const buf = Buffer.from(indices.map((i) => bytes[i] ?? 0));
  return signed ? buf.readInt16BE(0) : buf.readUInt16BE(0);
}

export interface ParseOptions {
  formato?: NumericFormat;
  byteOrder?: ByteOrder;
}

export function parseIEEE754(input: unknown, { formato = 'float32', byteOrder = 'BE' }: ParseOptions = {}): number {
  const bytes = normalizeToBytes(input);
  switch (formato) {
    case 'float32': return bytesToFloat32(bytes, byteOrder);
    case 'int32':   return bytesToInt32(bytes, byteOrder, true);
    case 'uint32':  return bytesToInt32(bytes, byteOrder, false);
    case 'int16':   return bytesToInt16(bytes, byteOrder, true);
    case 'uint16':  return bytesToInt16(bytes, byteOrder, false);
  }
}

function validateWord(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`${label} debe ser un entero entre 0 y 65535`);
  }
}

export interface RegistersResult {
  valor: number;
  wordSwap: boolean;
}

export function registrosModbusAFloat32(wordAlta: number, wordBaja: number, wordSwap = false): RegistersResult {
  validateWord(wordAlta, 'wordAlta');
  validateWord(wordBaja, 'wordBaja');
  const bufAlto = Buffer.allocUnsafe(2);
  const bufBajo = Buffer.allocUnsafe(2);
  bufAlto.writeUInt16BE(wordAlta, 0);
  bufBajo.writeUInt16BE(wordBaja, 0);
  const combined = wordSwap ? Buffer.concat([bufBajo, bufAlto]) : Buffer.concat([bufAlto, bufBajo]);
  return { valor: combined.readFloatBE(0), wordSwap };
}

export function registrosModbusAUInt32(wordAlta: number, wordBaja: number, wordSwap = false): RegistersResult {
  validateWord(wordAlta, 'wordAlta');
  validateWord(wordBaja, 'wordBaja');
  const alto = wordSwap ? wordBaja : wordAlta;
  const bajo = wordSwap ? wordAlta : wordBaja;
  return { valor: alto * 65536 + bajo, wordSwap };
}
