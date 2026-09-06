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
describe('applyMappingTransform · bit (senal digital)', () => {
  function bit(parametros: Record<string, unknown>, raw: number | string) {
    return applyMappingTransform({
      rawData: { REG1: raw },
      mapping: baseMapping({ transformacion: 'bit', d2: null, parametros }),
    });
  }

  // 0b0000_0000_1010_1011 = 171: bits 0,1,3,5,7 en 1.
  it('devuelve 1 cuando el bit esta encendido', () => {
    expect(bit({ bit: 0 }, 171)).toBe(1);
    expect(bit({ bit: 1 }, 171)).toBe(1);
    expect(bit({ bit: 3 }, 171)).toBe(1);
    expect(bit({ bit: 5 }, 171)).toBe(1);
    expect(bit({ bit: 7 }, 171)).toBe(1);
  });

  it('devuelve 0 cuando el bit esta apagado', () => {
    expect(bit({ bit: 2 }, 171)).toBe(0);
    expect(bit({ bit: 4 }, 171)).toBe(0);
    expect(bit({ bit: 15 }, 171)).toBe(0);
  });

  it('devuelve numeros y no booleans (contadores y alertas hacen Number)', () => {
    expect(typeof bit({ bit: 0 }, 1)).toBe('number');
    expect(typeof bit({ bit: 1 }, 1)).toBe('number');
  });

  it('lee el bit mas significativo de una palabra de 16', () => {
    expect(bit({ bit: 15 }, 32768)).toBe(1);
    expect(bit({ bit: 15 }, 32767)).toBe(0);
  });

  it('invertido da vuelta la senal (contacto normalmente cerrado)', () => {
    expect(bit({ bit: 0, invertido: true }, 171)).toBe(0);
    expect(bit({ bit: 2, invertido: true }, 171)).toBe(1);
  });

  it('una palabra en cero deja todos los bits en 0', () => {
    for (let i = 0; i < 16; i += 1) expect(bit({ bit: i }, 0)).toBe(0);
  });

  it('una palabra en 65535 deja todos los bits en 1', () => {
    for (let i = 0; i < 16; i += 1) expect(bit({ bit: i }, 65535)).toBe(1);
  });

  it('el crudo puede venir como string numerico', () => {
    expect(bit({ bit: 1 }, '171')).toBe(1);
    expect(bit({ bit: 2 }, '171')).toBe(0);
  });

  it('falla si el bit no esta configurado', () => {
    expect(() => bit({}, 171)).toThrow(/fuera de rango/);
  });

  it('falla si el bit no cabe en el ancho declarado', () => {
    expect(() => bit({ bit: 16 }, 171)).toThrow(/fuera de rango para una palabra de 16 bits/);
    expect(() => bit({ bit: -1 }, 171)).toThrow(/fuera de rango/);
    expect(() => bit({ bit: 1.5 }, 171)).toThrow(/fuera de rango/);
  });

  it('falla si la palabra no cabe en el ancho declarado', () => {
    // 70000 no es una palabra de 16 bits: los bits bajos seguirian dando 0/1
    // plausibles y el historico quedaria inventado.
    expect(() => bit({ bit: 0 }, 70000)).toThrow(/no es una palabra sin signo de 16 bits/);
    expect(() => bit({ bit: 0 }, -1)).toThrow(/no es una palabra sin signo/);
    expect(() => bit({ bit: 0 }, 12.5)).toThrow(/no es una palabra sin signo/);
  });

  it('falla si el crudo no es numerico', () => {
    expect(() => bit({ bit: 0 }, 'AB')).toThrow(/debe ser numerico/);
  });

  it('palabra_bits=32 amplia el ancho y los bits validos', () => {
    expect(bit({ bit: 16, palabra_bits: 32 }, 70000)).toBe(1); // 70000 = 0x11170
    expect(bit({ bit: 31, palabra_bits: 32 }, 2 ** 31)).toBe(1);
    expect(() => bit({ bit: 32, palabra_bits: 32 }, 1)).toThrow(/fuera de rango/);
  });

  it('un palabra_bits invalido cae al ancho por defecto de 16', () => {
    expect(bit({ bit: 0, palabra_bits: 17 }, 1)).toBe(1);
    expect(() => bit({ bit: 0, palabra_bits: 17 }, 70000)).toThrow(/de 16 bits/);
  });

  it('factor y offset no aplican: el valor es 1 o 0', () => {
    expect(bit({ bit: 0, factor: 100, offset: 5 }, 171)).toBe(1);
  });

  it('dos mapeos sobre la misma palabra leen bits distintos', () => {
    const rawData = { REG1: 171 };
    const marcha = applyMappingTransform({
      rawData,
      mapping: baseMapping({ transformacion: 'bit', d2: null, parametros: { bit: 0 } }),
    });
    const falla = applyMappingTransform({
      rawData,
      mapping: baseMapping({ id: 'm2', transformacion: 'bit', d2: null, parametros: { bit: 2 } }),
    });
    expect([marcha, falla]).toEqual([1, 0]);
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

/**
 * Cut-off de caudal bajo (`parametros.cut_off`).
 *
 * Caso real que lo motivó: S128 (Pozo 1, OB-0601-444). El FMT020 en reposo
 * oscila alrededor de cero — se midieron valores entre -0,066 y +0,061 L/s —
 * contra un caudal de trabajo de 14,3 L/s. Los negativos disparaban
 * `flow_negative` y mandaban el 26% de los slots DGA a `requires_review`.
 */
describe('applyMappingTransform · cut_off', () => {
  /** Arma un mapeo lineal para probar el corte sobre un valor ya escalado. */
  function lineal(raw: number, parametros: Record<string, unknown>) {
    return applyMappingTransform({
      rawData: { REG1: raw },
      mapping: baseMapping({
        d2: null,
        transformacion: 'lineal',
        parametros,
      }),
    });
  }

  it('sin cut_off no toca nada (retrocompatible)', () => {
    expect(lineal(-4, { factor: 0.01 })).toBeCloseTo(-0.04, 6);
  });

  it('lleva a 0 el negativo que cae bajo el umbral', () => {
    expect(lineal(-4, { factor: 0.01, cut_off: 0.1 })).toBe(0);
  });

  it('lleva a 0 el positivo diminuto: el corte es simétrico', () => {
    // Cortar solo los negativos dejaría la serie sesgada hacia arriba y el
    // promedio en reposo daría positivo en vez de cero.
    expect(lineal(6, { factor: 0.01, cut_off: 0.1 })).toBe(0);
  });

  it('respeta el caudal de trabajo: 14,3 no se toca con umbral 0,1', () => {
    expect(lineal(1430, { factor: 0.01, cut_off: 0.1 })).toBeCloseTo(14.3, 6);
  });

  it('el umbral es estricto: un valor igual al umbral sobrevive', () => {
    expect(lineal(10, { factor: 0.01, cut_off: 0.1 })).toBeCloseTo(0.1, 6);
  });

  it('un cut_off de 0 o negativo se ignora en vez de anular la variable', () => {
    expect(lineal(-4, { factor: 0.01, cut_off: 0 })).toBeCloseTo(-0.04, 6);
    expect(lineal(-4, { factor: 0.01, cut_off: -5 })).toBeCloseTo(-0.04, 6);
  });

  it('un cut_off no numérico se ignora', () => {
    expect(lineal(-4, { factor: 0.01, cut_off: 'mucho' })).toBeCloseTo(-0.04, 6);
  });

  it('se aplica DESPUÉS del factor, sobre unidades de ingeniería', () => {
    // Crudo 51,5 (m3/h) con divisor 3,6 → 14,3 L/s. El umbral 0,1 está en L/s:
    // si se aplicara sobre el crudo, 51,5 tampoco se cortaría, pero un umbral
    // de 20 sí delata el orden. 14,3 < 20 → 0.
    expect(lineal(515, { factor: 0.1 / 3.6, cut_off: 20 })).toBe(0);
  });

  it('funciona igual sobre ieee754_32', () => {
    const { high, low } = float32ToWords(-0.0337);
    const out = applyMappingTransform({
      rawData: { REG1: high, REG2: low },
      mapping: baseMapping({ parametros: { cut_off: 0.1 } }),
    });
    expect(out).toBe(0);
  });

  it('no toca las transformaciones que no devuelven un número', () => {
    // `directo` devuelve el crudo tal cual, incluso si es texto.
    const out = applyMappingTransform({
      rawData: { REG1: 'ON' },
      mapping: baseMapping({ d2: null, transformacion: 'directo', parametros: { cut_off: 5 } }),
    });
    expect(out).toBe('ON');
  });
});
