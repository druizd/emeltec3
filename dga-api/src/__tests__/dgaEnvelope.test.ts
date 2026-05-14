import { describe, it, expect } from 'vitest';
import { buildDgaPayload } from '../domain/submission/dgaEnvelope';
import type { DgaSubmissionPayload } from '../domain/submission/dgaEnvelope';

const informante = {
  rut: '20999888-7',
  clave: '9A4PUqd1t4',
  rutEmpresa: '77555666-7',
};

const basePayload: DgaSubmissionPayload = {
  informante,
  obraDga: 'OB-0101-114',
  report: {
    sitioId: 'S01',
    obra: 'OB-0101-114',
    timestamp: new Date('2023-09-07T14:00:00.000Z'), // UTC → UTC-4 = 10:00:00
    nivelFreatico: 9.85,
    caudal: 1.0,
    totalizado: 1010,
  },
};

describe('buildDgaPayload — headers', () => {
  it('codigoObra = obraDga', () => {
    const { headers } = buildDgaPayload(basePayload);
    expect(headers['codigoObra']).toBe('OB-0101-114');
  });

  it('timeStampOrigen en formato UTC-4 con offset -04:00', () => {
    const { headers } = buildDgaPayload(basePayload);
    // 2023-09-07T14:00:00Z → UTC-4 → 2023-09-07T10:00:00-04:00
    expect(headers['timeStampOrigen']).toBe('2023-09-07T10:00:00-04:00');
  });
});

describe('buildDgaPayload — autenticacion', () => {
  it('mapea rutUsuario, password y rutEmpresa', () => {
    const { body } = buildDgaPayload(basePayload);
    const auth = body['autenticacion'] as Record<string, string>;
    expect(auth['rutUsuario']).toBe('20999888-7');
    expect(auth['password']).toBe('9A4PUqd1t4');
    expect(auth['rutEmpresa']).toBe('77555666-7');
  });
});

describe('buildDgaPayload — medicionSubterranea', () => {
  it('fechaMedicion en formato YYYY-MM-DD (UTC-4)', () => {
    const { body } = buildDgaPayload(basePayload);
    const m = body['medicionSubterranea'] as Record<string, string>;
    expect(m['fechaMedicion']).toBe('2023-09-07');
  });

  it('horaMedicion en formato HH24:MI:SS (UTC-4)', () => {
    const { body } = buildDgaPayload(basePayload);
    const m = body['medicionSubterranea'] as Record<string, string>;
    expect(m['horaMedicion']).toBe('10:00:00');
  });

  it('caudal con 2 decimales (L/s)', () => {
    const { body } = buildDgaPayload(basePayload);
    const m = body['medicionSubterranea'] as Record<string, string>;
    expect(m['caudal']).toBe('1.00');
  });

  it('nivelFreaticoDelPozo con 2 decimales (m)', () => {
    const { body } = buildDgaPayload(basePayload);
    const m = body['medicionSubterranea'] as Record<string, string>;
    expect(m['nivelFreaticoDelPozo']).toBe('9.85');
  });

  it('totalizador sin decimales (m³)', () => {
    const { body } = buildDgaPayload(basePayload);
    const m = body['medicionSubterranea'] as Record<string, string>;
    expect(m['totalizador']).toBe('1010');
  });

  it('valores null → "0.00" o "0"', () => {
    const payload: DgaSubmissionPayload = {
      ...basePayload,
      report: { ...basePayload.report, nivelFreatico: null, caudal: null, totalizado: null },
    };
    const { body } = buildDgaPayload(payload);
    const m = body['medicionSubterranea'] as Record<string, string>;
    expect(m['nivelFreaticoDelPozo']).toBe('0.00');
    expect(m['caudal']).toBe('0.00');
    expect(m['totalizador']).toBe('0');
  });

  it('coincide con el ejemplo de la spec DGA enero 2025', () => {
    const { headers, body } = buildDgaPayload(basePayload);
    expect(headers['codigoObra']).toBe('OB-0101-114');
    const m = body['medicionSubterranea'] as Record<string, string>;
    expect(m).toMatchObject({
      caudal: '1.00',
      fechaMedicion: '2023-09-07',
      horaMedicion: '10:00:00',
      nivelFreaticoDelPozo: '9.85',
      totalizador: '1010',
    });
  });
});
