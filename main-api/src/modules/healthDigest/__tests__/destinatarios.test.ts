/**
 * Tests de los destinatarios configurables del monitoreo (healthDigest).
 *
 * Cubre lo que puede dejar el monitoreo mudo o ruidoso:
 *   - fail-open al buzón de respaldo (tabla vacía o query caída),
 *   - filtro por umbral de escalación,
 *   - reemplazo atómico de la lista (borra lo que ya no viene),
 *   - validación del PUT (emails inválidos, duplicados, tope).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../../../config/appConfig', () => ({
  config: { db: { slowLogMs: 1000, statementTimeoutMs: 5000 } },
}));

vi.mock('../../../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/heartbeat', () => ({ beat: vi.fn() }));

vi.mock('../../../config/dbHelpers', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../services/emailService.js', () => ({
  sendHealthDigest: vi.fn(async () => undefined),
}));

import { query, transaction } from '../../../config/dbHelpers';
import {
  listDestinatariosActivos,
  listDestinatariosSeguridad,
  replaceDestinatarios,
  normalizeEmail,
} from '../destinatariosRepo';
import { destinatariosParaEvento, resolveDestinatarios, MONITOR_PRIMARY } from '../worker';
import type { DigestDestinatario } from '../destinatariosRepo';

const mockQuery = query as Mock;
const mockTransaction = transaction as Mock;

function dest(over: Partial<DigestDestinatario> = {}): DigestDestinatario {
  return {
    email: 'persona@emeltec.cl',
    nombre: 'Persona',
    recibe_resumen: true,
    recibe_eventos: true,
    recibe_seguridad: true,
    umbral_evento: 't3',
    activo: true,
    updated_at: '2026-08-18T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── resolveDestinatarios: fail-open ─────────────────────────────────────────

describe('resolveDestinatarios — fail-open al buzón de respaldo', () => {
  it('devuelve los destinatarios activos de la BD cuando hay filas', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: 'a@emeltec.cl',
          nombre: 'A',
          recibe_resumen: true,
          recibe_eventos: false,
          umbral_evento: 't6',
          activo: true,
          updated_at: '2026-08-18T12:00:00Z',
        },
      ],
    });

    const result = await resolveDestinatarios();

    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe('a@emeltec.cl');
    expect(result[0]!.umbral_evento).toBe('t6');
    expect(result[0]!.recibe_eventos).toBe(false);
  });

  it('con la tabla vacía cae al buzón de respaldo suscrito a todo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolveDestinatarios();

    expect(result).toEqual([
      {
        email: MONITOR_PRIMARY,
        nombre: null,
        recibe_resumen: true,
        recibe_eventos: true,
        // El respaldo NO se arroga las alertas de seguridad: esas no tienen
        // buzón de fallback, las lee auditAlerts directo de la tabla.
        recibe_seguridad: false,
        umbral_evento: 't3',
        activo: true,
        updated_at: null,
      },
    ]);
  });

  it('si la query falla (migración sin aplicar) también cae al respaldo', async () => {
    mockQuery.mockRejectedValueOnce(
      new Error('relation "health_digest_destinatario" does not exist'),
    );

    const result = await resolveDestinatarios();

    expect(result).toHaveLength(1);
    expect(result[0]!.email).toBe(MONITOR_PRIMARY);
  });
});

// ─── Filtro por umbral de escalación ─────────────────────────────────────────

describe('destinatariosParaEvento — umbral por destinatario', () => {
  const lista = [
    dest({ email: 't3@emeltec.cl', umbral_evento: 't3' }),
    dest({ email: 't6@emeltec.cl', umbral_evento: 't6' }),
    dest({ email: 't12@emeltec.cl', umbral_evento: 't12' }),
  ];

  it('un evento t3 solo va a quien pidió desde 3 h', () => {
    const emails = destinatariosParaEvento(lista, 't3').map((d) => d.email);
    expect(emails).toEqual(['t3@emeltec.cl']);
  });

  it('un evento t6 va a los umbrales t3 y t6', () => {
    const emails = destinatariosParaEvento(lista, 't6').map((d) => d.email);
    expect(emails).toEqual(['t3@emeltec.cl', 't6@emeltec.cl']);
  });

  it('un evento t12 va a todos', () => {
    const emails = destinatariosParaEvento(lista, 't12').map((d) => d.email);
    expect(emails).toEqual(['t3@emeltec.cl', 't6@emeltec.cl', 't12@emeltec.cl']);
  });

  it('quien tiene escalaciones apagadas nunca recibe eventos', () => {
    const solos = [dest({ email: 'muted@emeltec.cl', recibe_eventos: false })];
    expect(destinatariosParaEvento(solos, 't12')).toEqual([]);
  });
});

// ─── Repo ────────────────────────────────────────────────────────────────────

describe('listDestinatariosActivos', () => {
  it('filtra por activo = TRUE en la SQL', async () => {
    let capturedSql = '';
    mockQuery.mockImplementationOnce(async (sql: string) => {
      capturedSql = sql;
      return { rows: [] };
    });

    await listDestinatariosActivos();

    expect(capturedSql).toMatch(/activo\s*=\s*TRUE/i);
  });

  it('normaliza un umbral desconocido a t3 en vez de propagar basura', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: 'x@emeltec.cl',
          nombre: null,
          recibe_resumen: true,
          recibe_eventos: true,
          umbral_evento: 'zzz',
          activo: true,
          updated_at: null,
        },
      ],
    });

    const rows = await listDestinatariosActivos();

    expect(rows[0]!.umbral_evento).toBe('t3');
  });
});

describe('listDestinatariosSeguridad', () => {
  it('filtra por activo y recibe_seguridad, y devuelve solo los correos', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'uno@emeltec.cl' }, { email: 'dos@emeltec.cl' }],
    });

    const emails = await listDestinatariosSeguridad();

    const [sql] = mockQuery.mock.calls[0] as [string];
    expect(sql).toContain('recibe_seguridad = TRUE');
    expect(sql).toContain('activo = TRUE');
    expect(emails).toEqual(['uno@emeltec.cl', 'dos@emeltec.cl']);
  });

  it('lista vacía devuelve vacío: estas alertas no tienen buzón de respaldo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // A diferencia de resolveDestinatarios(), acá NO se cae a MONITOR_PRIMARY:
    // nadie suscrito significa que no se manda nada (decisión explícita).
    await expect(listDestinatariosSeguridad()).resolves.toEqual([]);
  });
});

describe('normalizeEmail', () => {
  it('trim + minúsculas (el email es la PK de la tabla)', () => {
    expect(normalizeEmail('  Persona@Emeltec.CL ')).toBe('persona@emeltec.cl');
  });
});

describe('replaceDestinatarios — reemplazo atómico', () => {
  /** Ejecuta el callback de `transaction` con un client falso y captura las SQL. */
  function fakeTransaction(finalRows: Record<string, unknown>[]) {
    const calls: { sql: string; params: unknown[] | undefined }[] = [];
    mockTransaction.mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params?: unknown[]) => {
          calls.push({ sql, params });
          return { rows: sql.trimStart().startsWith('SELECT') ? finalRows : [] };
        },
      }),
    );
    return calls;
  }

  it('borra los emails que ya no vienen en la lista', async () => {
    const calls = fakeTransaction([]);

    await replaceDestinatarios(
      [
        {
          email: 'Queda@Emeltec.cl',
          nombre: 'Queda',
          recibe_resumen: true,
          recibe_eventos: true,
          recibe_seguridad: true,
          umbral_evento: 't3',
          activo: true,
        },
      ],
      'U1',
    );

    const del = calls.find((c) => /DELETE/i.test(c.sql));
    expect(del).toBeDefined();
    // El email normalizado es el que se preserva del borrado.
    expect(del!.params).toEqual([['queda@emeltec.cl']]);
  });

  it('con lista vacía borra todo (el worker pasa al buzón de respaldo)', async () => {
    const calls = fakeTransaction([]);

    await replaceDestinatarios([], 'U1');

    const del = calls.find((c) => /DELETE/i.test(c.sql));
    expect(del!.sql).toMatch(/DELETE FROM health_digest_destinatario\s*$/i);
    expect(calls.some((c) => /INSERT/i.test(c.sql))).toBe(false);
  });

  it('hace upsert por email y guarda el actor', async () => {
    const calls = fakeTransaction([]);

    await replaceDestinatarios(
      [
        {
          email: 'nuevo@emeltec.cl',
          nombre: '  Nuevo  ',
          recibe_resumen: false,
          recibe_eventos: true,
          recibe_seguridad: true,
          umbral_evento: 't12',
          activo: false,
        },
      ],
      'U9',
    );

    const ins = calls.find((c) => /INSERT/i.test(c.sql))!;
    expect(ins.sql).toMatch(/ON CONFLICT \(email\) DO UPDATE/i);
    expect(ins.params).toEqual([
      'nuevo@emeltec.cl',
      'Nuevo',
      false,
      true,
      true,
      't12',
      false,
      'U9',
    ]);
  });
});
