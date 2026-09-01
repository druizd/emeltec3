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

describe('applyMappingTransform · complemento a 2 (con_signo)', () => {
  function lineal(parametros: Record<string, unknown>, raw: number) {
    return applyMappingTransform({
      rawData: { REG1: raw },
      mapping: baseMapping({ transformacion: 'lineal', d2: null, parametros }),
    });
  }

  it('sin con_signo el crudo pasa tal cual (retrocompatible)', () => {
    expect(lineal({}, 65087)).toBe(65087);
  });

  it('con_signo lee 65087 como -449', () => {
    expect(lineal({ con_signo: true }, 65087)).toBe(-449);
  });

  it('el ultimo positivo de 16 bits no se toca', () => {
    expect(lineal({ con_signo: true }, 32767)).toBe(32767);
  });

  it('el primer negativo de 16 bits es -32768', () => {
    expect(lineal({ con_signo: true }, 32768)).toBe(-32768);
  });

  it('el signo se aplica antes del factor y el offset', () => {
    // 65087 -> -449, luego -449 * 0.1 + 5 = -39.9
    expect(lineal({ con_signo: true, factor: 0.1, offset: 5 }, 65087)).toBeCloseTo(-39.9, 6);
  });

  it('falla si el crudo no cabe en el ancho configurado', () => {
    expect(() => lineal({ con_signo: true }, 549087)).toThrow(/no cabe en un registro sin signo/);
  });

  it('signo_bits=32 corre el corte a 2.147.483.647', () => {
    expect(lineal({ con_signo: true, signo_bits: 32 }, 549087)).toBe(549087);
    expect(lineal({ con_signo: true, signo_bits: 32 }, 4294966747)).toBe(-549);
  });

  it('un signo_bits invalido cae al ancho por defecto', () => {
    expect(lineal({ con_signo: true, signo_bits: 17 }, 65087)).toBe(-449);
  });

  it('uint32_registros usa 32 bits por defecto', () => {
    const out = applyMappingTransform({
      rawData: { REG1: 65535, REG2: 65535 },
      mapping: baseMapping({
        transformacion: 'uint32_registros',
        parametros: { con_signo: true },
      }),
    });
    expect(out).toBe(-1);
  });

  it('uint32_registros sin con_signo mantiene el valor sin signo', () => {
    const out = applyMappingTransform({
      rawData: { REG1: 65535, REG2: 65535 },
      mapping: baseMapping({ transformacion: 'uint32_registros' }),
    });
    expect(out).toBe(4294967295);
  });

  it('la escala por rango opera sobre el valor ya con signo', () => {
    // factor/offset derivados de 4000-20000 -> 0-20 bar; 65087 -> -449 -> -5.56 bar
    const out = applyMappingTransform({
      rawData: { REG1: 65087 },
      mapping: baseMapping({
        transformacion: 'lineal',
        d2: null,
        parametros: {
          con_signo: true,
          modo_escala: 'rango',
          raw_min: 4000,
          raw_max: 20000,
          ing_min: 0,
          ing_max: 20,
          factor: 0.00125,
          offset: -5,
        },
      }),
    });
    expect(out).toBeCloseTo(-5.56125, 5);
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
