/**
 * Fachada TIPADA sobre la fuente única de transformaciones físicas.
 *
 * La matemática (IEEE754, lineal, uint32, nivel freático, caudal) vive en
 * `src/utils/mappingTransform.js` — CommonJS puro para que la consuman tanto
 * estos módulos TS como `services/siteTelemetryService.js` sin duplicar código.
 * Aquí sólo agregamos tipos y re-exportamos.
 */
import type { PozoConfig, RegMap } from './types';

export interface VariableParameters {
  factor?: number | null;
  offset?: number | null;
  con_signo?: boolean | null;
  signo_bits?: number | null;
  word_order?: string | null;
  word_swap?: boolean | null;
  wordSwap?: boolean | null;
  formato?: string | null;
  byteOrder?: string | null;
}

export interface MappingTransformInput {
  rawData: unknown;
  mapping: RegMap;
  pozoConfig?: PozoConfig | null;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mappingTransformMod = require('../../utils/mappingTransform.js') as {
  applyMappingTransform: (input: MappingTransformInput) => number | unknown;
  applyLinearTransform: (value: unknown, params: Record<string, unknown>) => number;
  applySignedWrap: (value: number, bits: number) => number;
  normalizeTransform: (value: unknown) => string;
  parseMappingParams: (value: unknown) => Record<string, unknown>;
  readRawValue: (rawData: unknown, key: string | null | undefined) => unknown;
  numberOrNull: (value: unknown) => number | null;
  isPlainObject: (value: unknown) => value is Record<string, unknown>;
};

export const applyMappingTransform = mappingTransformMod.applyMappingTransform;
export const applyLinearTransform = mappingTransformMod.applyLinearTransform;
export const applySignedWrap = mappingTransformMod.applySignedWrap;
export const normalizeTransform = mappingTransformMod.normalizeTransform;
export const parseMappingParams = mappingTransformMod.parseMappingParams;
export const readRawValue = mappingTransformMod.readRawValue;
export const numberOrNull = mappingTransformMod.numberOrNull;
export const isPlainObject = mappingTransformMod.isPlainObject;
