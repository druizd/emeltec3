/**
 * CSV "Declarado a la DGA" del apartado DGA del pozo.
 *
 * El archivo trae todos los slots del rango, no solo los enviados. Sin una
 * columna de estado, un slot pendiente salía con el voucher vacío y se leía
 * como un envío sin folio; y una baja hecha por un operador no decía por qué.
 *
 * Lo que se protege:
 *   1. Las cinco primeras columnas no cambian de orden (hay quien ya procesa
 *      el archivo).
 *   2. Cada fila dice su estado con la misma etiqueta que la pantalla.
 *   3. Una baja manual sale como "Dado de baja" con su motivo y la nota del
 *      operador; un `fallido` real sigue siendo "Fallido".
 */
import { describe, it, expect, vi } from 'vitest';

// appConfig valida el entorno al cargarse y hace process.exit(1) si falta algo.
vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
    redis: { url: '', enabled: false },
    dga: { encryptionKey: 'x'.repeat(32) },
    monitor: { primaryEmail: 'monitoreo@emeltec.cl' },
  },
}));

vi.mock('../../../config/redis', () => ({
  getRedis: vi.fn(() => null),
  redisEnabled: false,
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  transaction: vi.fn(),
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { DatoDgaRow } from '../repo';
import { toCsvDeclarado } from '../service';

function slot(over: Partial<DatoDgaRow>): DatoDgaRow {
  return {
    site_id: 'S130',
    obra: 'OB-0601-447',
    ts: '2026-09-01T04:00:00.000Z',
    fecha: '2026-09-01',
    hora: '00:00:00',
    caudal_instantaneo: '12.5',
    flujo_acumulado: '100503',
    nivel_freatico: '0.5',
    estatus: 'enviado',
    fail_reason: null,
    baja_nota: null,
    comprobante: 'ABC123',
    ...over,
  } as DatoDgaRow;
}

/** Celdas de la única fila de datos. */
function celdas(row: DatoDgaRow): string[] {
  return (toCsvDeclarado([row]).split('\r\n')[1] ?? '').split(';');
}

describe('toCsvDeclarado', () => {
  it('agrega ESTADO y OBSERVACIÓN al final, sin mover las cinco columnas', () => {
    expect(toCsvDeclarado([]).split('\r\n')[0]).toBe(
      'FECHA;NIVEL FREÁTICO [M];CAUDAL [L/S];TOTALIZADOR [M3];VOUCHER;ESTADO;OBSERVACIÓN',
    );
  });

  it('un slot enviado lleva su voucher y queda sin observación', () => {
    expect(celdas(slot({}))).toEqual([
      '01/09/2026 00:00',
      '0,5',
      '12,5',
      '100503',
      'ABC123',
      'Enviado',
      '',
    ]);
  });

  it('un slot sin enviar sale igual, con el estado que explica el voucher vacío', () => {
    const c = celdas(slot({ estatus: 'pendiente', comprobante: null }));
    expect(c[4]).toBe('');
    expect(c[5]).toBe('Pendiente');
  });

  it('vacio y requires_review usan las etiquetas de la tabla del pozo', () => {
    expect(celdas(slot({ estatus: 'vacio', comprobante: null }))[5]).toBe('Pendiente');
    expect(celdas(slot({ estatus: 'requires_review', comprobante: null }))[5]).toBe('Revisar');
  });

  it('una baja por rango sale como Dado de baja con el motivo y la nota', () => {
    const c = celdas(
      slot({
        estatus: 'fallido',
        comprobante: null,
        fail_reason: 'baja_recambio_instrumento',
        baja_nota: 'Recambio del 04-09',
      }),
    );
    expect(c[5]).toBe('Dado de baja');
    expect(c[6]).toBe(
      'Período sin medición por recambio de instrumento. El equipo fue reemplazado y no hay dato que declarar. — Recambio del 04-09',
    );
  });

  it('una baja de a una no repite la nota que ya está en fail_reason', () => {
    const c = celdas(
      slot({
        estatus: 'fallido',
        comprobante: null,
        fail_reason: 'Sensor desconectado',
        baja_nota: 'Sensor desconectado',
      }),
    );
    expect(c[5]).toBe('Dado de baja');
    expect(c[6]).toBe('Sensor desconectado');
  });

  it('un fallido por reintentos agotados no se disfraza de baja', () => {
    const c = celdas(slot({ estatus: 'fallido', comprobante: null, fail_reason: 'timeout' }));
    expect(c[5]).toBe('Fallido');
    expect(c[6]).toBe('');
  });

  it('una nota con punto y coma va entre comillas y no corre las columnas', () => {
    const csv = toCsvDeclarado([
      slot({
        estatus: 'fallido',
        comprobante: null,
        fail_reason: 'baja_otro',
        baja_nota: 'Equipo apagado; sin acceso',
      }),
    ]);
    expect(csv.split('\r\n')[1]).toMatch(/;Dado de baja;".*Equipo apagado; sin acceso"$/);
  });
});
