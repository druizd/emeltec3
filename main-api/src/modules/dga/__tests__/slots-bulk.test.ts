/**
 * Tests de las acciones en bloque sobre un rango de slots DGA.
 *
 * Lo que realmente hay que blindar acá es a QUIÉN tocan. Estas dos funciones
 * reescriben `dato_dga` sobre un rango entero, y un WHERE de más o de menos no
 * falla en compilación: se lleva declaraciones ya hechas.
 *
 * Tres invariantes:
 *   1. `enviado` y `enviando` NUNCA entran. El primero ya salió a SNIA con
 *      folio y reescribirlo falsearía una declaración hecha; el segundo tiene
 *      un envío en vuelo.
 *   2. El rango es semiabierto [desde, hasta) y va acotado al sitio, en el CTE
 *      y otra vez en el UPDATE.
 *   3. Hay un tope de filas por request.
 *
 * Contexto real: S128 (Pozo 1, OB-0601-444). Tras corregir la unidad del
 * caudal había 55 slots materializados con el valor viejo —51 L/s en vez de
 * 14,3— y 6 en `pendiente` con el totalizador en modo neto. Todo eso se
 * resolvió por SQL a mano, que es lo que estas funciones vienen a reemplazar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  transaction: vi.fn(),
}));

import { query } from '../../../config/dbHelpers';
import { BULK_SLOT_LIMIT, bulkDiscardSlots, countSlotsByEstado, resetSlotsToVacio } from '../repo';
import { BulkSlotActionPayload } from '../schema';

/** SQL y args de la última llamada a query(), con el whitespace normalizado. */
function ultimaLlamada(): { sql: string; args: unknown[] } {
  const calls = vi.mocked(query).mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('query() no fue llamada');
  return { sql: String(last[0]).replace(/\s+/g, ' '), args: (last[1] ?? []) as unknown[] };
}

const RANGO = {
  site_id: 'S128',
  desde: '2026-09-04T17:00:00Z',
  hasta: '2026-09-07T00:00:00Z',
};

describe('resetSlotsToVacio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deja los slots en vacio y limpia lo que describía el valor viejo', async () => {
    await resetSlotsToVacio(RANGO);
    const { sql } = ultimaLlamada();
    expect(sql).toContain("SET estatus = 'vacio'");
    expect(sql).toContain('fail_reason = NULL');
    expect(sql).toContain('next_retry_at = NULL');
    // Los warnings hablaban de los valores viejos: quedarían mintiendo.
    expect(sql).toContain('validation_warnings = NULL');
  });

  it('NUNCA toca enviado ni enviando', async () => {
    await resetSlotsToVacio(RANGO);
    const { args } = ultimaLlamada();
    const estados = args[3] as string[];
    expect(estados).toEqual(['pendiente', 'requires_review', 'fallido']);
    expect(estados).not.toContain('enviado');
    expect(estados).not.toContain('enviando');
  });

  it('acota al sitio en el CTE y otra vez en el UPDATE', async () => {
    await resetSlotsToVacio(RANGO);
    const { sql, args } = ultimaLlamada();
    expect(args[0]).toBe('S128');
    // Dos veces: una filtrando el CTE, otra en el WHERE del UPDATE.
    expect(sql.match(/site_id\s*=\s*\$1/g)?.length).toBe(2);
  });

  it('el rango es semiabierto: incluye desde, excluye hasta', async () => {
    await resetSlotsToVacio(RANGO);
    const { sql, args } = ultimaLlamada();
    expect(sql).toContain('ts >= $2');
    expect(sql).toContain('ts < $3');
    expect(args[1]).toBe(RANGO.desde);
    expect(args[2]).toBe(RANGO.hasta);
  });

  it('lleva tope de filas', async () => {
    await resetSlotsToVacio(RANGO);
    expect(ultimaLlamada().sql).toContain(`LIMIT ${BULK_SLOT_LIMIT}`);
  });

  it('devuelve cuántas filas tocó', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 55 } as never);
    await expect(resetSlotsToVacio(RANGO)).resolves.toBe(55);
  });
});

describe('bulkDiscardSlots', () => {
  const CON_NOTA = {
    ...RANGO,
    admin_note: 'Totalizador en modo neto, dato no declarable',
    admin_email: 'druiz@emeltec.cl',
  };

  beforeEach(() => vi.clearAllMocks());

  it('cierra como fallido y deja la nota y el autor dentro del slot', async () => {
    await bulkDiscardSlots(CON_NOTA);
    const { sql, args } = ultimaLlamada();
    expect(sql).toContain("SET estatus = 'fallido'");
    expect(sql).toContain("'code', 'admin_discarded_bulk'");
    // Se AGREGA al array existente en vez de reemplazarlo: la baja no borra
    // el warning que explicaba por qué el slot estaba retenido.
    expect(sql).toContain('COALESCE(d.validation_warnings');
    expect(args[3]).toBe(CON_NOTA.admin_note);
    expect(args[4]).toBe(CON_NOTA.admin_email);
  });

  it('NUNCA toca enviado ni enviando', async () => {
    await bulkDiscardSlots(CON_NOTA);
    const estados = ultimaLlamada().args[5] as string[];
    expect(estados).toEqual(['pendiente', 'requires_review', 'fallido']);
    expect(estados).not.toContain('enviado');
    expect(estados).not.toContain('enviando');
  });

  it('acota al sitio dos veces y lleva tope', async () => {
    await bulkDiscardSlots(CON_NOTA);
    const { sql } = ultimaLlamada();
    expect(sql.match(/site_id\s*=\s*\$1/g)?.length).toBe(2);
    expect(sql).toContain(`LIMIT ${BULK_SLOT_LIMIT}`);
  });
});

describe('countSlotsByEstado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('agrupa por estado sobre el mismo rango semiabierto', async () => {
    await countSlotsByEstado(RANGO);
    const { sql } = ultimaLlamada();
    expect(sql).toContain('GROUP BY estatus');
    expect(sql).toContain('ts >= $2');
    expect(sql).toContain('ts < $3');
  });

  it('convierte el count a número: postgres devuelve bigint como string', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ estatus: 'pendiente', total: '32' }],
      rowCount: 1,
    } as never);
    await expect(countSlotsByEstado(RANGO)).resolves.toEqual([{ estatus: 'pendiente', total: 32 }]);
  });
});

describe('BulkSlotActionPayload', () => {
  const base = {
    action: 'recalcular' as const,
    desde: '2026-09-04T17:00:00Z',
    hasta: '2026-09-07T00:00:00Z',
    nota: 'Corregida la unidad del caudal',
  };

  it('acepta un payload completo', () => {
    expect(BulkSlotActionPayload.safeParse(base).success).toBe(true);
  });

  it('rechaza un rango invertido', () => {
    const r = BulkSlotActionPayload.safeParse({ ...base, desde: base.hasta, hasta: base.desde });
    expect(r.success).toBe(false);
  });

  it('rechaza desde == hasta: un rango vacío no es una acción', () => {
    expect(BulkSlotActionPayload.safeParse({ ...base, hasta: base.desde }).success).toBe(false);
  });

  it('exige nota: un rango sin explicación es lo que hace imposible auditarlo', () => {
    expect(BulkSlotActionPayload.safeParse({ ...base, nota: '' }).success).toBe(false);
    expect(BulkSlotActionPayload.safeParse({ ...base, nota: 'ok' }).success).toBe(false);
  });

  it('solo acepta las dos acciones conocidas', () => {
    expect(BulkSlotActionPayload.safeParse({ ...base, action: 'enviar' }).success).toBe(false);
    expect(BulkSlotActionPayload.safeParse({ ...base, action: 'dar_de_baja' }).success).toBe(true);
  });

  it('exige fechas con offset explícito', () => {
    expect(BulkSlotActionPayload.safeParse({ ...base, desde: '2026-09-04' }).success).toBe(false);
  });
});
