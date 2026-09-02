/**
 * Set estándar de reglas de alerta por sitio: se crea lo que falta y no se
 * toca lo que ya existe. Con DGA activo suma las dos reglas DGA.
 */
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { crearAlertasPorDefecto } = require('../alertasPorDefecto') as {
  crearAlertasPorDefecto: (
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
    input: { sitioId: string; userId?: string | null },
  ) => Promise<{ creadas: string[]; existentes: string[]; omitidas: string[] }>;
};

function makeDb({
  sitio,
  existentes = [],
  variables = [],
}: {
  sitio: Record<string, unknown> | null;
  existentes?: string[];
  variables?: string[];
}) {
  const inserts: unknown[][] = [];
  const db = {
    inserts,
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM sitio s/.test(sql)) return { rows: sitio ? [sitio] : [] };
      if (/SELECT condicion FROM alertas/.test(sql)) {
        return { rows: existentes.map((condicion) => ({ condicion })) };
      }
      if (/FROM reg_map/.test(sql)) return { rows: variables.map((d1) => ({ d1 })) };
      if (/INSERT INTO alertas/.test(sql)) {
        inserts.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
  return db;
}

const pozoDga = {
  id: 'S127',
  empresa_id: 'E113',
  sub_empresa_id: 'SE115',
  id_serial: '151.21.36.25',
  tipo_sitio: 'pozo',
  dga_activo: true,
};

describe('crearAlertasPorDefecto', () => {
  it('pozo con DGA activo y sin reglas: crea las tres', async () => {
    const db = makeDb({ sitio: pozoDga, variables: ['AI24'] });
    const r = await crearAlertasPorDefecto(db, { sitioId: 'S127', userId: 'SA001' });

    expect(r.creadas).toEqual(['sin_datos', 'dga_atrasado', 'sobre_derecho_dga']);
    expect(r.existentes).toEqual([]);
    expect(db.inserts).toHaveLength(3);
    // sin_datos guarda la primera variable del reg_map; las DGA su clave implicita.
    expect(db.inserts.map((p) => p[5])).toEqual(['AI24', 'dga', 'caudal']);
    // Todas con la guardia Emeltec y el creador como destinatarios (defaults).
    expect(db.inserts.every((p) => p[10] === 'SA001')).toBe(true);
  });

  it('respeta las condiciones que el sitio ya tiene', async () => {
    const db = makeDb({ sitio: pozoDga, existentes: ['sin_datos', 'dga_atrasado'] });
    const r = await crearAlertasPorDefecto(db, { sitioId: 'S127' });

    expect(r.creadas).toEqual(['sobre_derecho_dga']);
    expect(r.existentes).toEqual(['sin_datos', 'dga_atrasado']);
    expect(db.inserts).toHaveLength(1);
  });

  it('sitio sin DGA: solo la de equipo sin comunicacion', async () => {
    const db = makeDb({ sitio: { ...pozoDga, dga_activo: false }, variables: [] });
    const r = await crearAlertasPorDefecto(db, { sitioId: 'S127' });

    expect(r.creadas).toEqual(['sin_datos']);
    expect(r.omitidas).toEqual(['dga_atrasado', 'sobre_derecho_dga']);
    // Sin reg_map cae en la clave generica; el backend exige una.
    expect(db.inserts[0]![5]).toBe('equipo');
  });

  it('sitio sin equipo ni DGA: no crea nada', async () => {
    const db = makeDb({ sitio: { ...pozoDga, id_serial: null, dga_activo: false } });
    const r = await crearAlertasPorDefecto(db, { sitioId: 'S127' });
    expect(r.creadas).toEqual([]);
    expect(r.omitidas).toHaveLength(3);
    expect(db.inserts).toHaveLength(0);
  });

  it('sitio inexistente: error 404', async () => {
    const db = makeDb({ sitio: null });
    await expect(crearAlertasPorDefecto(db, { sitioId: 'S999' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
