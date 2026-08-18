/**
 * Tests de los filtros de la cola de revisión DGA.
 *
 * El riesgo real acá es el armado de placeholders: el listado reserva `$1`
 * para el LIMIT y el conteo no lleva ninguno, así que el mismo builder de
 * WHERE tiene que numerar distinto según quién lo llame. Un `$N` corrido no
 * falla en compilación — devuelve filas equivocadas o revienta en runtime.
 *
 * Y el listado y el conteo TIENEN que derivar del mismo WHERE: si divergen,
 * el "mostrando N de M" de la página miente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  transaction: vi.fn(),
}));

import { query } from '../../../config/dbHelpers';
import { countSlotsRequiresReview, listReviewQueueSites, listSlotsRequiresReview } from '../repo';

/** SQL y args de la última llamada a query(), con el whitespace normalizado. */
function ultimaLlamada(): { sql: string; args: unknown[] } {
  const calls = vi.mocked(query).mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('query() no fue llamada');
  return { sql: String(last[0]).replace(/\s+/g, ' '), args: (last[1] ?? []) as unknown[] };
}

describe('listSlotsRequiresReview — placeholders y filtros', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin filtros: solo el LIMIT en $1', async () => {
    await listSlotsRequiresReview({});
    const { sql, args } = ultimaLlamada();
    expect(args).toEqual([100]);
    expect(sql).toContain("d.estatus = 'requires_review'");
    expect(sql).toContain('LIMIT $1');
    expect(sql).not.toContain('d.site_id =');
    expect(sql).not.toContain('d.ts >=');
  });

  it('numera los filtros DESPUES del limit, sin pisar $1', async () => {
    await listSlotsRequiresReview({
      site_id: 'S127',
      desde: '2026-06-01T00:00:00.000Z',
      hasta: '2026-06-30T23:59:59.999Z',
    });
    const { sql, args } = ultimaLlamada();
    expect(args).toEqual([100, 'S127', '2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.999Z']);
    expect(sql).toContain('d.site_id = $2');
    expect(sql).toContain('d.ts >= $3::timestamptz');
    expect(sql).toContain('d.ts <= $4::timestamptz');
    expect(sql).toContain('LIMIT $1');
  });

  it('corre la numeracion cuando falta un filtro intermedio', async () => {
    await listSlotsRequiresReview({ hasta: '2026-06-30T23:59:59.999Z' });
    const { sql, args } = ultimaLlamada();
    expect(args).toEqual([100, '2026-06-30T23:59:59.999Z']);
    expect(sql).toContain('d.ts <= $2::timestamptz');
    expect(sql).not.toContain('d.ts >=');
  });

  it('topa el limit en 500 aunque pidan mas', async () => {
    await listSlotsRequiresReview({ limit: 5000 });
    expect(ultimaLlamada().args[0]).toBe(500);
  });
});

describe('countSlotsRequiresReview — mismo WHERE, sin LIMIT', () => {
  beforeEach(() => vi.clearAllMocks());

  it('empieza a numerar en $1 porque no reserva el limit', async () => {
    await countSlotsRequiresReview({
      site_id: 'S127',
      desde: '2026-06-01T00:00:00.000Z',
    });
    const { sql, args } = ultimaLlamada();
    expect(args).toEqual(['S127', '2026-06-01T00:00:00.000Z']);
    expect(sql).toContain('d.site_id = $1');
    expect(sql).toContain('d.ts >= $2::timestamptz');
    expect(sql).not.toContain('LIMIT');
  });

  it('aplica exactamente las mismas condiciones que el listado', async () => {
    const filtros = {
      site_id: 'S130',
      desde: '2026-05-01T00:00:00.000Z',
      hasta: '2026-05-31T23:59:59.999Z',
    };
    await listSlotsRequiresReview(filtros);
    const lista = ultimaLlamada().sql;
    vi.clearAllMocks();
    await countSlotsRequiresReview(filtros);
    const conteo = ultimaLlamada().sql;

    // Las condiciones son las mismas salvo el corrimiento del placeholder que
    // introduce el LIMIT. Aislamos el WHERE y normalizamos $N para comparar.
    const soloWhere = (sql: string) =>
      (sql.split(' WHERE ')[1] ?? '').split(' ORDER BY ')[0]!.replace(/\$\d+/g, '$?').trim();
    expect(soloWhere(conteo)).toBe(soloWhere(lista));
    expect(soloWhere(lista)).toContain('d.site_id = $?');

    // El WHERE igual no alcanza: el listado hace INNER JOIN a pozo_config y
    // descarta los slots cuyo sitio no tiene config. Si el conteo no arrastra
    // ese JOIN, el total supera a lo mostrado y el aviso de "hay N mas" queda
    // prendido para siempre. Paso en produccion: la pagina mostraba 79 de 80.
    expect(conteo).toContain('JOIN pozo_config pc ON pc.sitio_id = d.site_id');
  });

  it('devuelve 0 cuando la consulta no trae filas', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    await expect(countSlotsRequiresReview({})).resolves.toBe(0);
  });

  it('devuelve el total que reporta la consulta', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total: 340 }], rowCount: 1 } as never);
    await expect(countSlotsRequiresReview({})).resolves.toBe(340);
  });
});

describe('listReviewQueueSites — catalogo del selector', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no aplica ningun filtro: es el catalogo, no la vista filtrada', async () => {
    await listReviewQueueSites();
    const { sql, args } = ultimaLlamada();
    expect(args).toEqual([]);
    expect(sql).toContain("d.estatus = 'requires_review'");
    expect(sql).toContain('SELECT DISTINCT');
    expect(sql).not.toContain('d.site_id = $');
    expect(sql).not.toContain('d.ts >=');
  });
});
