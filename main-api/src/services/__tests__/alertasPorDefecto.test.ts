/**
 * Catálogo de reglas recomendadas por sitio: se listan con su aplicabilidad,
 * se crean las pedidas (o todas las que apliquen) y no se toca lo que existe.
 */
import { describe, expect, it, vi } from 'vitest';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { crearAlertasPorDefecto, listarAlertasRecomendadas } = require('../alertasPorDefecto') as {
  crearAlertasPorDefecto: (
    db: Db,
    input: { sitioId: string; userId?: string | null; condiciones?: string[] | null },
  ) => Promise<{ creadas: string[]; existentes: string[]; omitidas: string[] }>;
  listarAlertasRecomendadas: (
    db: Db,
    input: { sitioId: string },
  ) => Promise<
    Array<{ condicion: string; aplica: boolean; motivo_no_aplica: string | null; existe: boolean }>
  >;
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

describe('listarAlertasRecomendadas', () => {
  it('pozo con DGA: las tres aplican; marca la que ya existe', async () => {
    const db = makeDb({ sitio: pozoDga, existentes: ['sin_datos'] });
    const r = await listarAlertasRecomendadas(db, { sitioId: 'S127' });
    expect(r.map((x) => x.condicion)).toEqual(['sin_datos', 'dga_atrasado', 'sobre_derecho_dga']);
    expect(r.every((x) => x.aplica)).toBe(true);
    expect(r.map((x) => x.existe)).toEqual([true, false, false]);
  });

  it('sitio sin DGA ni equipo: ninguna aplica y cada una dice por qué', async () => {
    const db = makeDb({ sitio: { ...pozoDga, id_serial: null, dga_activo: false } });
    const r = await listarAlertasRecomendadas(db, { sitioId: 'S127' });
    expect(r.every((x) => !x.aplica)).toBe(true);
    expect(r[0]!.motivo_no_aplica).toMatch(/equipo/);
    expect(r[1]!.motivo_no_aplica).toMatch(/DGA/);
  });
});

describe('crearAlertasPorDefecto', () => {
  it('sin filtro (uso automático): crea todas las que aplican', async () => {
    const db = makeDb({ sitio: pozoDga, variables: ['AI24'] });
    const r = await crearAlertasPorDefecto(db, { sitioId: 'S127', userId: 'SA001' });

    expect(r.creadas).toEqual(['sin_datos', 'dga_atrasado', 'sobre_derecho_dga']);
    expect(db.inserts).toHaveLength(3);
    // sin_datos guarda la primera variable del reg_map; las DGA su clave implicita.
    expect(db.inserts.map((p) => p[5])).toEqual(['AI24', 'dga', 'caudal']);
    expect(db.inserts.every((p) => p[10] === 'SA001')).toBe(true);
  });

  it('con filtro (selector): crea solo las marcadas', async () => {
    const db = makeDb({ sitio: pozoDga });
    const r = await crearAlertasPorDefecto(db, {
      sitioId: 'S127',
      condiciones: ['sobre_derecho_dga'],
    });
    expect(r.creadas).toEqual(['sobre_derecho_dga']);
    expect(r.omitidas).toEqual(['sin_datos', 'dga_atrasado']);
    expect(db.inserts).toHaveLength(1);
  });

  it('respeta las condiciones que el sitio ya tiene', async () => {
    const db = makeDb({ sitio: pozoDga, existentes: ['sin_datos', 'dga_atrasado'] });
    const r = await crearAlertasPorDefecto(db, { sitioId: 'S127' });
    expect(r.creadas).toEqual(['sobre_derecho_dga']);
    expect(r.existentes).toEqual(['sin_datos', 'dga_atrasado']);
  });

  it('una marcada que no aplica se omite, no falla', async () => {
    const db = makeDb({ sitio: { ...pozoDga, dga_activo: false }, variables: [] });
    const r = await crearAlertasPorDefecto(db, {
      sitioId: 'S127',
      condiciones: ['sin_datos', 'dga_atrasado'],
    });
    expect(r.creadas).toEqual(['sin_datos']);
    expect(r.omitidas).toEqual(['dga_atrasado', 'sobre_derecho_dga']);
    // Sin reg_map cae en la clave generica; el backend exige una.
    expect(db.inserts[0]![5]).toBe('equipo');
  });

  it('sitio inexistente: error 404', async () => {
    const db = makeDb({ sitio: null });
    await expect(crearAlertasPorDefecto(db, { sitioId: 'S999' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
