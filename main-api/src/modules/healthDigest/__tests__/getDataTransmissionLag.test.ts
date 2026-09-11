/**
 * Tests unitarios para getDataTransmissionLag.
 *
 * Incidente 20-08-2026: la subquery pedía `MAX(received_at)` sin acotar por
 * `time`, la columna de particionamiento de la hypertable `equipo`. Sin ese
 * filtro no hay exclusión de chunks y el máximo recorre todo el historial de
 * cada equipo, una vez por sitio. El índice (id_serial, time) no ayuda, porque
 * el máximo se pide sobre una columna que no está en él.
 *
 * En producción tardaba 26 s y moría contra DB_STATEMENT_TIMEOUT_MS: el botón
 * "Enviar prueba" devolvía 500 y cada ciclo del worker habría fallado igual.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: {
    db: { slowLogMs: 1000, statementTimeoutMs: 5000 },
  },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import { query } from '../../../config/dbHelpers';
import { getDataTransmissionLag } from '../repo';

const mockQuery = query as Mock;

const FILA = {
  site_id: 'S101',
  descripcion: 'Pozo Norte',
  empresa_nombre: 'Empresa Test',
  id_serial: '151.20.35.3',
  last_received_at: '2026-08-20T18:00:00.000Z',
};

function sqlEjecutado(): string {
  return String(mockQuery.mock.calls[0]![0]);
}

describe('getDataTransmissionLag — acotar la hypertable', () => {
  it('la subquery filtra por `time` para que la hypertable excluya chunks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [FILA] });

    await getDataTransmissionLag();

    const sql = sqlEjecutado();
    // El filtro DEBE ser sobre `time`: es la columna de particionamiento, y es
    // la única que permite exclusión de chunks. Filtrar por received_at no poda.
    expect(sql).toMatch(/AND\s+time\s*>\s*NOW\(\)\s*-\s*INTERVAL/i);
    expect(sql).toContain('MAX(received_at)');
  });

  it('la ventana cubre de sobra el peor tier del worker (12 h)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [FILA] });

    await getDataTransmissionLag();

    const dias = Number(/INTERVAL '(\d+) days'/.exec(sqlEjecutado())?.[1]);
    // El worker clasifica en t3/t6/t12 y trata last_received_at=null como el
    // peor tier, así que la ventana solo tiene que ser holgada frente a 12 h.
    expect(dias).toBeGreaterThanOrEqual(7);
  });

  it('sigue excluyendo maletas y sitios inactivos', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [FILA] });

    await getDataTransmissionLag();

    const sql = sqlEjecutado();
    expect(sql).toContain("s.tipo_sitio <> 'maleta'");
    expect(sql).toContain('s.activo = TRUE');
    expect(sql).toContain('s.id_serial IS NOT NULL');
  });

  it('devuelve las filas tal como vienen (el worker calcula el tier)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [FILA] });

    const rows = await getDataTransmissionLag();

    expect(rows).toEqual([FILA]);
  });

  it('un sitio sin datos en la ventana llega con last_received_at nulo', async () => {
    // No es un caso de error: el worker lo trata como el peor tier. Antes ese
    // mismo sitio era el más caro de resolver, porque el MAX no encontraba nada
    // hasta recorrer el historial completo.
    mockQuery.mockResolvedValueOnce({ rows: [{ ...FILA, last_received_at: null }] });

    const rows = await getDataTransmissionLag();

    expect(rows[0]!.last_received_at).toBeNull();
  });
});
