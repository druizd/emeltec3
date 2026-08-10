/**
 * Test de caracterización: buildSiteDashboardData debe transformar cada rol
 * usando la MISMA matemática que modules/sites/transforms.ts (fuente única).
 *
 * Cubre directo, lineal, ieee754_32 (con offset) y uint32_registros (con
 * offset). Sirve de red de seguridad para el refactor que elimina la copia
 * duplicada de applyMappingTransform en siteTelemetryService.js.
 */
import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildSiteDashboardData } = require('../siteTelemetryService') as {
  buildSiteDashboardData: (input: unknown) => { variables: Array<Record<string, unknown>> };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { float32ToBytes } = require('../../utils/ieee754.js') as {
  float32ToBytes: (v: number, order?: string) => number[];
};

function float32ToWords(value: number): { high: number; low: number } {
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = float32ToBytes(value, 'BE');
  return { high: (b0 << 8) | b1, low: (b2 << 8) | b3 };
}

const site = { id: 's1', descripcion: 'Sitio', id_serial: 'SER1', tipo_sitio: 'generico' };

function build(mappings: unknown[], rawData: Record<string, unknown>) {
  const out = buildSiteDashboardData({
    site,
    pozoConfig: null,
    mappings,
    latest: { data: rawData, time: '2026-01-01T00:00:00Z', received_at: '2026-01-01T00:00:00Z' },
  });
  return out.variables;
}

function valorFor(vars: Array<Record<string, unknown>>, id: string): number {
  const v = vars.find((item) => item['id'] === id);
  return v?.['valor'] as number;
}

describe('siteTelemetryService · paridad de transformaciones', () => {
  const { high, low } = float32ToWords(25.5);

  const mappings = [
    { id: 'directo', alias: 'D', d1: 'RAW', d2: null, transformacion: 'directo', parametros: null },
    {
      id: 'lineal',
      alias: 'L',
      d1: 'RAW',
      d2: null,
      transformacion: 'lineal',
      parametros: { factor: 2, offset: 5 },
    },
    {
      id: 'ieee',
      alias: 'I',
      d1: 'REG_H',
      d2: 'REG_L',
      transformacion: 'ieee754_32',
      parametros: { offset: 10 },
    },
    {
      id: 'uint32',
      alias: 'U',
      d1: 'U_H',
      d2: 'U_L',
      transformacion: 'uint32_registros',
      parametros: { factor: 0.5, offset: 1 },
    },
  ];

  const rawData = { RAW: 3, REG_H: high, REG_L: low, U_H: 1, U_L: 0 };

  it('directo devuelve el valor crudo', () => {
    expect(valorFor(build(mappings, rawData), 'directo')).toBe(3);
  });

  it('lineal aplica factor y offset', () => {
    expect(valorFor(build(mappings, rawData), 'lineal')).toBeCloseTo(11, 5); // 3*2+5
  });

  it('ieee754_32 aplica offset al float decodificado', () => {
    expect(valorFor(build(mappings, rawData), 'ieee')).toBeCloseTo(35.5, 5); // 25.5+10
  });

  it('uint32_registros aplica factor y offset al combinado', () => {
    // (1*65536 + 0) * 0.5 + 1 = 32769
    expect(valorFor(build(mappings, rawData), 'uint32')).toBeCloseTo(32769, 5);
  });
});
