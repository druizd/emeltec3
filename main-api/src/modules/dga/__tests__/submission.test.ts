/**
 * Tests unitarios para submission.ts.
 *
 * Cubre:
 *   - CODIGO_OBRA_REGEX (Res 2170 §5.2)
 *   - parseSniaDuplicateMessage (respuesta 400 "Ya existe un registro")
 *   - runSubmissionCycle con respuesta duplicada de SNIA (incidente
 *     jun-jul 2026: timeouts que sí llegaron → reintentos diarios → falso
 *     `fallido` pese a que DGA ya tenía el dato)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    dga: {
      apiUrl: 'https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas',
      rutEmpresa: '77555666-7',
      encryptionKey: 'test-key',
      submissionEnabled: true,
    },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/heartbeat', () => ({
  beat: vi.fn(),
}));

vi.mock('../../../config/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../../../config/metrics', () => ({
  dbQueryDuration: { startTimer: vi.fn(() => () => 0) },
}));

vi.mock('../repo', () => ({
  findExistingSuccessfulAudit: vi.fn(async () => null),
  insertSendAudit: vi.fn(async () => undefined),
  listPendingForSubmission: vi.fn(async () => []),
  lockSlotForSending: vi.fn(async () => true),
  markSlotEnviado: vi.fn(async () => undefined),
  markSlotRechazado: vi.fn(async () => ({ terminal: false })),
}));

vi.mock('../crypto', () => ({
  decryptClave: vi.fn(() => 'clave-plana'),
}));

vi.mock('../snia-client', () => ({
  sendToSnia: vi.fn(),
}));

import { listPendingForSubmission, markSlotEnviado, markSlotRechazado } from '../repo';
import { sendToSnia } from '../snia-client';
import { CODIGO_OBRA_REGEX, parseSniaDuplicateMessage, runSubmissionCycle } from '../submission';

const SLOT = {
  site_id: 'S999',
  ts: '2026-07-09T09:00:00.000Z',
  obra: 'Pozo test',
  codigo_obra: 'OB-0602-7',
  caudal_instantaneo: '12.50',
  flujo_acumulado: '1000',
  nivel_freatico: '8.20',
  attempts: 1,
  rut_informante: '11111111-1',
  clave_informante: 'cifrada',
  max_retry_attempts: 5,
};

function sniaResult(overrides: Record<string, unknown>) {
  return {
    ok: false,
    http_status: 400,
    dga_status_code: '400',
    dga_message: null,
    numero_comprobante: null,
    request_payload_redacted: {},
    raw_response: '{}',
    duration_ms: 100,
    ...overrides,
  };
}

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

describe('parseSniaDuplicateMessage', () => {
  it('detecta duplicado y extrae comprobante (mensaje real SNIA)', () => {
    const msg =
      'Ya existe un registro en esa fecha, hora para la obra. Comprobante: HsfIKMWBP7a8970dQ9DuUA82ZE694DHI';
    expect(parseSniaDuplicateMessage(msg)).toEqual({
      duplicate: true,
      comprobante: 'HsfIKMWBP7a8970dQ9DuUA82ZE694DHI',
    });
  });

  it('tolera variaciones de mayúsculas y espacios', () => {
    const msg = 'YA EXISTE UN REGISTRO en esa fecha. comprobante:  abc123XYZ';
    expect(parseSniaDuplicateMessage(msg)).toEqual({
      duplicate: true,
      comprobante: 'abc123XYZ',
    });
  });

  it('duplicado sin comprobante en el mensaje → comprobante null', () => {
    const msg = 'Ya existe un registro en esa fecha, hora para la obra.';
    expect(parseSniaDuplicateMessage(msg)).toEqual({ duplicate: true, comprobante: null });
  });

  it('mensaje de error distinto → no duplicado', () => {
    expect(parseSniaDuplicateMessage('Formato de caudal inválido')).toEqual({
      duplicate: false,
      comprobante: null,
    });
  });

  it('mensaje null → no duplicado', () => {
    expect(parseSniaDuplicateMessage(null)).toEqual({ duplicate: false, comprobante: null });
  });
});

describe('runSubmissionCycle — respuesta 400 duplicado de SNIA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPendingForSubmission).mockResolvedValue([SLOT] as never);
  });

  it('400 "Ya existe un registro" con comprobante → marca enviado con ese comprobante', async () => {
    vi.mocked(sendToSnia).mockResolvedValue(
      sniaResult({
        dga_message:
          'Ya existe un registro en esa fecha, hora para la obra. Comprobante: lKz4sy6qr8ILVTRJd43SZEErwKpdITYJ',
      }) as never,
    );

    await runSubmissionCycle();

    expect(markSlotEnviado).toHaveBeenCalledWith({
      site_id: SLOT.site_id,
      ts: SLOT.ts,
      comprobante: 'lKz4sy6qr8ILVTRJd43SZEErwKpdITYJ',
    });
    expect(markSlotRechazado).not.toHaveBeenCalled();
  });

  it('400 duplicado SIN comprobante → rechazado con fail_reason dga_duplicate_sin_comprobante', async () => {
    vi.mocked(sendToSnia).mockResolvedValue(
      sniaResult({
        dga_message: 'Ya existe un registro en esa fecha, hora para la obra.',
      }) as never,
    );

    await runSubmissionCycle();

    expect(markSlotEnviado).not.toHaveBeenCalled();
    expect(markSlotRechazado).toHaveBeenCalledWith(
      expect.objectContaining({
        site_id: SLOT.site_id,
        ts: SLOT.ts,
        fail_reason: 'dga_duplicate_sin_comprobante',
      }),
    );
  });

  it('400 NO duplicado → comportamiento actual (fail_reason dga_status_400)', async () => {
    vi.mocked(sendToSnia).mockResolvedValue(
      sniaResult({ dga_message: 'Formato de caudal inválido' }) as never,
    );

    await runSubmissionCycle();

    expect(markSlotEnviado).not.toHaveBeenCalled();
    expect(markSlotRechazado).toHaveBeenCalledWith(
      expect.objectContaining({ fail_reason: 'dga_status_400' }),
    );
  });

  it('status "00" OK sigue marcando enviado con numero_comprobante de la respuesta', async () => {
    vi.mocked(sendToSnia).mockResolvedValue(
      sniaResult({
        ok: true,
        http_status: 200,
        dga_status_code: '00',
        numero_comprobante: 'COMP-OK-1',
      }) as never,
    );

    await runSubmissionCycle();

    expect(markSlotEnviado).toHaveBeenCalledWith({
      site_id: SLOT.site_id,
      ts: SLOT.ts,
      comprobante: 'COMP-OK-1',
    });
  });
});
