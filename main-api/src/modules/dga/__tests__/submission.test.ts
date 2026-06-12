/**
 * Tests unitarios para submission.ts.
 *
 * Cubre validaciones puras de pre-envío:
 *   - CODIGO_OBRA_REGEX (Res 2170 §5.2)
 *
 * Cobertura adicional de processSlot end-to-end queda para tests E2E con
 * stub SNIA local (requiere mocks pesados de repo + cliente HTTP).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    dga: {
      apiUrl: 'https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas',
      rutEmpresa: '77555666-7',
      encryptionKey: 'test-key',
      submissionEnabled: false,
    },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../../../config/metrics', () => ({
  dbQueryDuration: { startTimer: vi.fn(() => () => 0) },
}));

import { CODIGO_OBRA_REGEX } from '../submission';

describe('CODIGO_OBRA_REGEX — Res 2170 §5.2', () => {
  it('acepta OB-NNNN-N (correlativo 1 dígito)', () => {
    // Ejemplo Res 2170: "OB-0602-7" — Región 6, Provincia 2, séptima obra.
    expect(CODIGO_OBRA_REGEX.test('OB-0602-7')).toBe(true);
  });

  it('acepta OR-NNNN-NN (obra de restitución)', () => {
    expect(CODIGO_OBRA_REGEX.test('OR-0101-12')).toBe(true);
  });

  it('acepta correlativo de varios dígitos', () => {
    expect(CODIGO_OBRA_REGEX.test('OB-1316-9999')).toBe(true);
  });

  it('acepta correlativo de 3 dígitos (caso histórico repo)', () => {
    expect(CODIGO_OBRA_REGEX.test('OB-0601-292')).toBe(true);
  });

  it('rechaza otro prefijo distinto de OB/OR', () => {
    expect(CODIGO_OBRA_REGEX.test('AB-0602-7')).toBe(false);
    expect(CODIGO_OBRA_REGEX.test('XX-0602-7')).toBe(false);
  });

  it('rechaza si parte 2 no tiene 4 dígitos', () => {
    expect(CODIGO_OBRA_REGEX.test('OB-062-7')).toBe(false);
    expect(CODIGO_OBRA_REGEX.test('OB-06022-7')).toBe(false);
    expect(CODIGO_OBRA_REGEX.test('OB-ABCD-7')).toBe(false);
  });

  it('rechaza correlativo no numérico', () => {
    expect(CODIGO_OBRA_REGEX.test('OB-0602-A')).toBe(false);
    expect(CODIGO_OBRA_REGEX.test('OB-0602-')).toBe(false);
  });

  it('rechaza string vacío o nulo-like', () => {
    expect(CODIGO_OBRA_REGEX.test('')).toBe(false);
    expect(CODIGO_OBRA_REGEX.test(' ')).toBe(false);
  });

  it('rechaza minúsculas (regex case-sensitive)', () => {
    expect(CODIGO_OBRA_REGEX.test('ob-0602-7')).toBe(false);
  });

  it('rechaza con espacios extra', () => {
    expect(CODIGO_OBRA_REGEX.test('OB-0602-7 ')).toBe(false);
    expect(CODIGO_OBRA_REGEX.test(' OB-0602-7')).toBe(false);
  });

  it('rechaza con prefijo "OB" pero sin parte 3', () => {
    expect(CODIGO_OBRA_REGEX.test('OB-0602-')).toBe(false);
    expect(CODIGO_OBRA_REGEX.test('OB-0602')).toBe(false);
  });
});
