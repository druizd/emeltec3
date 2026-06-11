/**
 * Tests unitarios para buildSniaPayload — función pura, sin IO.
 *
 * Cubre formato exigido por Res 2170 §4 (Manual Técnico DGA 1/2025):
 *   - caudal: string numérico 2 decimales, L/s
 *   - totalizador: entero string sin decimales, m³, máx 15 chars
 *   - nivelFreaticoDelPozo: 2 decimales o "" (vacío permitido pozos pequeños)
 *   - Headers codigoObra + timeStampOrigen yyyy-MM-ddTHH:mm:ss-0000
 *   - Password redactado en bodyRedacted
 */
import { describe, it, expect, vi } from 'vitest';

// vi.mock se hoistea por vitest al top del archivo, antes de los imports
// estáticos. Por eso buildSniaPayload puede importarse directamente abajo.
vi.mock('../../../config/appConfig', () => ({
  config: {
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

import { buildSniaPayload } from '../snia-client';

const baseInput = {
  codigoObra: 'OB-0601-001',
  rutInformante: '20999888-7',
  password: 'secret-pass',
  fechaMedicion: '2026-06-11',
  horaMedicion: '13:00:00',
  caudal: 15.314,
  totalizador: 1010,
  nivelFreatico: 9.851,
};

describe('buildSniaPayload — happy path', () => {
  it('estructura body conforme Res 2170 §4', () => {
    const out = buildSniaPayload(baseInput);
    expect(out.body).toEqual({
      autenticacion: {
        password: 'secret-pass',
        rutEmpresa: '77555666-7',
        rutUsuario: '20999888-7',
      },
      medicionSubterranea: {
        caudal: '15.31',
        fechaMedicion: '2026-06-11',
        horaMedicion: '13:00:00',
        nivelFreaticoDelPozo: '9.85',
        totalizador: '1010',
      },
    });
  });

  it('headers incluyen codigoObra + timeStampOrigen + Content-Type', () => {
    const out = buildSniaPayload(baseInput);
    expect(out.headers['codigoObra']).toBe('OB-0601-001');
    expect(out.headers['Content-Type']).toBe('application/json');
    // timeStampOrigen formato yyyy-MM-ddTHH:mm:ss-0000
    expect(out.headers['timeStampOrigen']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0000$/);
  });

  it('url apunta al endpoint mockado', () => {
    const out = buildSniaPayload(baseInput);
    expect(out.url).toBe('https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas');
  });
});

describe('buildSniaPayload — formato caudal', () => {
  it('caudal con muchos decimales → trunca a 2 con redondeo', () => {
    const out = buildSniaPayload({ ...baseInput, caudal: 15.999 });
    expect((out.body.medicionSubterranea as Record<string, unknown>).caudal).toBe('16.00');
  });

  it('caudal entero → "10.00" (siempre 2 decimales)', () => {
    const out = buildSniaPayload({ ...baseInput, caudal: 10 });
    expect((out.body.medicionSubterranea as Record<string, unknown>).caudal).toBe('10.00');
  });

  it('caudal NULL → null en payload (DGA acepta null para caudal cero/ausente)', () => {
    const out = buildSniaPayload({ ...baseInput, caudal: null });
    expect((out.body.medicionSubterranea as Record<string, unknown>).caudal).toBeNull();
  });

  it('caudal cero → "0.00"', () => {
    const out = buildSniaPayload({ ...baseInput, caudal: 0 });
    expect((out.body.medicionSubterranea as Record<string, unknown>).caudal).toBe('0.00');
  });
});

describe('buildSniaPayload — formato totalizador', () => {
  it('totalizador con decimales → trunca a entero string', () => {
    const out = buildSniaPayload({ ...baseInput, totalizador: 1010.7 });
    expect((out.body.medicionSubterranea as Record<string, unknown>).totalizador).toBe('1010');
  });

  it('totalizador NULL → null', () => {
    const out = buildSniaPayload({ ...baseInput, totalizador: null });
    expect((out.body.medicionSubterranea as Record<string, unknown>).totalizador).toBeNull();
  });

  it('totalizador 0 → "0"', () => {
    const out = buildSniaPayload({ ...baseInput, totalizador: 0 });
    expect((out.body.medicionSubterranea as Record<string, unknown>).totalizador).toBe('0');
  });

  it('totalizador > 15 chars → throws (Res 2170 §4 límite)', () => {
    // 10^16 = 17 chars como entero.
    expect(() => buildSniaPayload({ ...baseInput, totalizador: 1e16 })).toThrowError(
      /totalizador excede 15 caracteres/,
    );
  });

  it('totalizador con 15 chars exactos → OK', () => {
    // 999_999_999_999_999 = 15 chars.
    const out = buildSniaPayload({ ...baseInput, totalizador: 999_999_999_999_999 });
    expect(
      ((out.body.medicionSubterranea as Record<string, unknown>).totalizador as string).length,
    ).toBeLessThanOrEqual(15);
  });
});

describe('buildSniaPayload — formato nivelFreatico', () => {
  it('nivel positivo con muchos decimales → 2 decimales', () => {
    const out = buildSniaPayload({ ...baseInput, nivelFreatico: 12.345678 });
    expect((out.body.medicionSubterranea as Record<string, unknown>).nivelFreaticoDelPozo).toBe(
      '12.35',
    );
  });

  it('nivel NULL → "" (vacío permitido caudales muy pequeños / minería)', () => {
    const out = buildSniaPayload({ ...baseInput, nivelFreatico: null });
    expect((out.body.medicionSubterranea as Record<string, unknown>).nivelFreaticoDelPozo).toBe('');
  });

  it('nivel cero → "0.00"', () => {
    const out = buildSniaPayload({ ...baseInput, nivelFreatico: 0 });
    expect((out.body.medicionSubterranea as Record<string, unknown>).nivelFreaticoDelPozo).toBe(
      '0.00',
    );
  });
});

describe('buildSniaPayload — bodyRedacted (audit)', () => {
  it('password se reemplaza por "****" en bodyRedacted', () => {
    const out = buildSniaPayload(baseInput);
    const redactedAuth = out.bodyRedacted.autenticacion as Record<string, unknown>;
    expect(redactedAuth.password).toBe('****');
    expect(redactedAuth.rutEmpresa).toBe('77555666-7');
    expect(redactedAuth.rutUsuario).toBe('20999888-7');
  });

  it('bodyRedacted incluye _headers para diagnóstico', () => {
    const out = buildSniaPayload(baseInput);
    const headers = out.bodyRedacted._headers as Record<string, unknown>;
    expect(headers.codigoObra).toBe('OB-0601-001');
    expect(headers.timeStampOrigen).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0000$/);
  });

  it('body original mantiene password en claro (es lo que se envía a SNIA)', () => {
    const out = buildSniaPayload(baseInput);
    expect((out.body.autenticacion as Record<string, unknown>).password).toBe('secret-pass');
  });
});

describe('buildSniaPayload — validaciones de rut', () => {
  it('formatea rutInformante via formatRutForDga', () => {
    // Si rutInformante viene con puntos / sin guión, igual debe formatearse.
    const out = buildSniaPayload({ ...baseInput, rutInformante: '20.999.888-7' });
    expect((out.body.autenticacion as Record<string, unknown>).rutUsuario).toBe('20999888-7');
  });
});
