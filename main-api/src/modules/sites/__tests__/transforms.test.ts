/**
 * Tests unitarios para applyMappingTransform (transformaciones físicas).
 *
 * Foco: ieee754_32 debe aplicar factor + offset igual que uint32_registros,
 * manteniendo retrocompatibilidad (sin params → valor sin alterar).
 */
import { describe, it, expect } from 'vitest';
import { applyMappingTransform } from '../transforms';
import type { RegMap } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { float32ToBytes } = require('../../../utils/ieee754.js') as {
  float32ToBytes: (v: number, order?: string) => number[];
};

/** Descompone un float32 en sus dos words de 16 bits (Big-Endian, ABCD). */
function float32ToWords(value: number): { high: number; low: number } {
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = float32ToBytes(value, 'BE');
  return {
    high: (b0 << 8) | b1,
    low: (b2 << 8) | b3,
  };
}

function baseMapping(overrides: Partial<RegMap> = {}): RegMap {
  return {
    id: 'm1',
    alias: 'test',
    d1: 'REG1',
    d2: 'REG2',
    tipo_dato: 'FLOAT',
    unidad: null,
    rol_dashboard: 'generico',
    transformacion: 'ieee754_32',
    parametros: null,
    sitio_id: 's1',
    ...overrides,
  } as RegMap;
}

describe('applyMappingTransform · ieee754_32 con dos registros', () => {
  const { high, low } = float32ToWords(25.5);
  const rawData = { REG1: high, REG2: low };

  it('sin params devuelve el float decodificado sin alterar', () => {
    const out = applyMappingTransform({ rawData, mapping: baseMapping() });
    expect(out).toBeCloseTo(25.5, 5);
  });

  it('aplica offset sumándolo al valor decodificado', () => {
    const out = applyMappingTransform({
      rawData,
      mapping: baseMapping({ parametros: { offset: 10 } }),
    });
    expect(out).toBeCloseTo(35.5, 5);
  });

  it('aplica factor y offset: raw * factor + offset', () => {
    const out = applyMappingTransform({
      rawData,
      mapping: baseMapping({ parametros: { factor: 2, offset: -0.5 } }),
    });
    expect(out).toBeCloseTo(50.5, 5);
  });
});

describe('applyMappingTransform · ieee754_32 con hex de un registro', () => {
  // 0x41CC0000 = 25.5 en float32 BE
  const rawData = { REG1: '41CC0000' };

  it('aplica offset al valor decodificado desde hex', () => {
    const out = applyMappingTransform({
      rawData,
      mapping: baseMapping({
        d2: null,
        parametros: { offset: 4 },
      }),
    });
    expect(out).toBeCloseTo(29.5, 5);
  });
});
