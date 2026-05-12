/**
 * Capa TS sobre las transformaciones físicas (IEEE754, lineal, nivel freático,
 * caudal). Reusa los helpers en `src/utils/*.js` para no duplicar matemática.
 */
import {
  parseIEEE754,
  registrosModbusAFloat32,
  registrosModbusAUInt32,
  type ByteOrder,
  type Formato,
} from '../../utils/ieee754';
import { m3hALs } from '../../utils/caudal';
import { calcularNivelFreatico } from '../../utils/nivelFreatico';
import type { PozoConfig, RegMap } from './types';

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requireFiniteNumber(value: unknown, label: string): number {
  const n = numberOrNull(value);
  if (n === null) throw new Error(`${label} debe ser numerico`);
  return n;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRawValue(rawData: unknown, key: string | null | undefined): unknown {
  if (!key || !isPlainObject(rawData)) return undefined;
  return rawData[key];
}

function parseBooleanParam(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'si', 'yes'].includes(String(value).trim().toLowerCase());
}

function normalizeTransform(value: unknown): string {
  const raw = String(value ?? 'directo')
    .trim()
    .toLowerCase();
  if (raw === 'escala_lineal') return 'lineal';
  if (raw === 'ieee754') return 'ieee754_32';
  if (raw === 'caudal') return 'caudal_m3h_lps';
  if (raw === 'uint32') return 'uint32_registros';
  return raw;
}

function parseMappingParams(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function applyLinearTransform(value: unknown, params: Record<string, unknown>): number {
  const base = requireFiniteNumber(value, 'valor');
  const factor = numberOrNull(params.factor) ?? 1;
  const offset = numberOrNull(params.offset) ?? 0;
  return base * factor + offset;
}

export interface MappingTransformInput {
  rawData: unknown;
  mapping: RegMap;
  pozoConfig?: PozoConfig | null;
}

/** Devuelve el valor transformado o lanza Error si la transformación no aplica. */
export function applyMappingTransform({
  rawData,
  mapping,
  pozoConfig,
}: MappingTransformInput): number | unknown {
  const params = parseMappingParams(mapping.parametros);
  const transform = normalizeTransform(mapping.transformacion);
  const rawD1 = readRawValue(rawData, mapping.d1);

  switch (transform) {
    case 'directo':
      return rawD1;

    case 'lineal':
      return applyLinearTransform(rawD1, params);

    case 'ieee754_32': {
      if (mapping.d2) {
        const high = requireFiniteNumber(rawD1, mapping.d1);
        const low = requireFiniteNumber(readRawValue(rawData, mapping.d2), mapping.d2);
        const wordSwap = parseBooleanParam(params.word_swap ?? params.wordSwap, false);
        return registrosModbusAFloat32(high, low, wordSwap).valor;
      }
      if (rawD1 === undefined || rawD1 === null) {
        throw new Error(`No existe dato crudo ${mapping.d1}`);
      }
      return parseIEEE754(rawD1, {
        formato: ((params.formato as string | undefined) ?? 'float32') as Formato,
        byteOrder: ((params.byteOrder as string | undefined) ??
          (params.word_order as string | undefined) ??
          'BE') as ByteOrder,
      });
    }

    case 'uint32_registros': {
      const high = requireFiniteNumber(rawD1, mapping.d1);
      const low = requireFiniteNumber(readRawValue(rawData, mapping.d2), mapping.d2 ?? 'd2');
      const wordSwap = parseBooleanParam(params.word_swap ?? params.wordSwap, false);
      return registrosModbusAUInt32(high, low, wordSwap).valor;
    }

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
      throw new Error(`transformacion no soportada: ${transform}`);
  }
}

export { normalizeTransform, parseMappingParams, readRawValue, numberOrNull, isPlainObject };
