/**
 * Convivencia de varios mapeos sobre el mismo dato original.
 *
 * Una palabra de 16 bits donde cada bit es una senal digital se configura como
 * N variables que comparten `d1` y difieren en `parametros.bit`. El candado
 * historico ("un mapeo por dato original") lo impedia, asi que se relajo SOLO
 * para ese caso: bits distintos de la misma palabra conviven, todo lo demas
 * sigue chocando. Mezclar un bit con una lectura analogica del mismo registro
 * serian dos interpretaciones incompatibles del mismo dato.
 *
 * El pool se sustituye via `require.cache`, NO con `vi.mock`: companyController
 * es CommonJS y hace `require('../config/db')`, que pasa por el loader de Node
 * y vitest no parchea. Mismo patron que companyController.serial.test.ts.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fila = Record<string, unknown>;

const consultas: { sql: string; params: unknown[] }[] = [];

/** Mapeos que ya existen sobre el `d1` consultado. */
let mapeosExistentes: Fila[] = [];
/** El mapeo que devuelve el SELECT por id en el PATCH. */
let mapeoActual: Fila | null = null;

const sitio = {
  id: 'S200',
  descripcion: 'Planta',
  empresa_id: 'E1',
  sub_empresa_id: 'SE1',
  id_serial: '151.2.2.9',
  tipo_sitio: 'generico',
  activo: true,
};

function responder(sql: string): { rows: Fila[]; rowCount: number } {
  const rows = (() => {
    if (sql.includes('FROM sitio WHERE id = ')) return [sitio];
    if (
      sql.includes('FROM reg_map\n          WHERE id =') ||
      sql.includes('FROM reg_map WHERE id =')
    )
      return mapeoActual ? [mapeoActual] : [];
    if (sql.includes('FROM reg_map')) return mapeosExistentes;
    if (sql.includes('INSERT INTO reg_map')) return [{ id: 'RMNEW' }];
    if (sql.includes('UPDATE reg_map')) return [{ id: mapeoActual?.id ?? 'RM1' }];
    return [];
  })();
  return { rows, rowCount: rows.length };
}

const ejecutar = async (sql: string, params: unknown[] = []) => {
  consultas.push({ sql, params });
  return responder(sql);
};

const poolFalso = {
  query: ejecutar,
  connect: async () => ({ query: ejecutar, release: () => {} }),
};

const require_ = createRequire(path.join(process.cwd(), 'vitest-require-root.js'));

const dbPath = require_.resolve('./src/config/db');
require_.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: poolFalso,
} as unknown as NodeJS.Module;

const controller = require_('./src/controllers/companyController') as {
  createSiteVariableMap: (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
  updateSiteVariableMap: (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
};

const makeRes = () => {
  const res = {
    status: vi.fn((_code?: number) => res),
    json: vi.fn((_payload?: unknown) => res),
  };
  return res;
};

const superAdmin = { id: 'U1', tipo: 'SuperAdmin' };

/** Un mapeo por bit ya guardado sobre REG20. */
function bitGuardado(id: string, alias: string, bit: number): Fila {
  return { id, alias, d1: 'REG20', transformacion: 'bit', parametros: { bit, palabra_bits: 16 } };
}

const errorDe = (res: ReturnType<typeof makeRes>) =>
  (res.json.mock.calls[0]?.[0] as { error?: string })?.error ?? '';

const seInserto = () => consultas.some((c) => c.sql.includes('INSERT INTO reg_map'));
const seActualizo = () => consultas.some((c) => c.sql.includes('UPDATE reg_map'));

beforeEach(() => {
  consultas.length = 0;
  mapeosExistentes = [];
  mapeoActual = null;
});

describe('createSiteVariableMap — palabra separada en bits', () => {
  const req = (body: Record<string, unknown> = {}) => ({
    params: { siteId: 'S200' },
    user: superAdmin,
    body: {
      alias: 'Marcha bomba 1',
      d1: 'REG20',
      tipo_dato: 'BOOLEAN',
      transformacion: 'bit',
      parametros: { bit: 0, palabra_bits: 16 },
      ...body,
    },
  });

  it('crea el primer bit de una palabra sin mapeos', async () => {
    const res = makeRes();
    await controller.createSiteVariableMap(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(seInserto()).toBe(true);
  });

  it('acepta un segundo bit distinto sobre el MISMO dato original', async () => {
    mapeosExistentes = [bitGuardado('RM1', 'Marcha bomba 1', 0)];
    const res = makeRes();

    await controller.createSiteVariableMap(
      req({ alias: 'Falla termico', parametros: { bit: 1, palabra_bits: 16 } }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(seInserto()).toBe(true);
  });

  it('rechaza dos senales sobre el mismo bit y nombra a la que lo ocupa', async () => {
    mapeosExistentes = [bitGuardado('RM1', 'Marcha bomba 1', 3)];
    const res = makeRes();

    await controller.createSiteVariableMap(
      req({ alias: 'Otra cosa', parametros: { bit: 3, palabra_bits: 16 } }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(errorDe(res)).toContain('El bit 3 de REG20');
    expect(errorDe(res)).toContain('Marcha bomba 1');
    expect(seInserto()).toBe(false);
  });

  it('rechaza separar en bits un registro que ya se lee como analogico', async () => {
    mapeosExistentes = [
      { id: 'RM1', alias: 'Presion', d1: 'REG20', transformacion: 'lineal', parametros: {} },
    ];
    const res = makeRes();

    await controller.createSiteVariableMap(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(errorDe(res)).toContain('Presion');
    expect(seInserto()).toBe(false);
  });

  it('rechaza una lectura analogica sobre una palabra ya separada en bits', async () => {
    mapeosExistentes = [bitGuardado('RM1', 'Marcha bomba 1', 0)];
    const res = makeRes();

    await controller.createSiteVariableMap(
      req({ alias: 'Presion', transformacion: 'lineal', parametros: { factor: 1 } }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(errorDe(res)).toContain('ya tiene un mapeo');
    expect(seInserto()).toBe(false);
  });

  it('mantiene el candado de siempre entre dos variables analogicas', async () => {
    mapeosExistentes = [
      { id: 'RM1', alias: 'Presion', d1: 'REG20', transformacion: 'lineal', parametros: {} },
    ];
    const res = makeRes();

    await controller.createSiteVariableMap(
      req({ alias: 'Otra presion', transformacion: 'lineal', parametros: {} }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(seInserto()).toBe(false);
  });

  it('rechaza un bit sin indice', async () => {
    const res = makeRes();
    await controller.createSiteVariableMap(req({ parametros: {} }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(errorDe(res)).toContain('parametros.bit');
    expect(seInserto()).toBe(false);
  });

  it('rechaza un bit que no cabe en el ancho declarado', async () => {
    const res = makeRes();
    await controller.createSiteVariableMap(
      req({ parametros: { bit: 16, palabra_bits: 16 } }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(errorDe(res)).toContain('entre 0 y 15');
    expect(seInserto()).toBe(false);
  });

  it('con palabra_bits=32 el bit 16 es valido', async () => {
    const res = makeRes();
    await controller.createSiteVariableMap(
      req({ parametros: { bit: 16, palabra_bits: 32 } }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rechaza un bit no entero', async () => {
    const res = makeRes();
    await controller.createSiteVariableMap(req({ parametros: { bit: 1.5 } }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(seInserto()).toBe(false);
  });

  it('rechaza un bit con rol de dashboard analogico', async () => {
    const res = makeRes();
    await controller.createSiteVariableMap(req({ rol_dashboard: 'caudal' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(errorDe(res)).toContain('rol generico');
    expect(seInserto()).toBe(false);
  });

  it('acepta un bit con rol generico explicito', async () => {
    const res = makeRes();
    await controller.createSiteVariableMap(req({ rol_dashboard: 'generico' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateSiteVariableMap — palabra separada en bits', () => {
  const req = (body: Record<string, unknown> = {}) => ({
    params: { siteId: 'S200', mapId: 'RM1' },
    user: superAdmin,
    body,
  });

  it('deja mover un bit a un indice libre', async () => {
    mapeoActual = bitGuardado('RM1', 'Marcha bomba 1', 0);
    mapeosExistentes = [bitGuardado('RM2', 'Falla termico', 1)];
    const res = makeRes();

    await controller.updateSiteVariableMap(
      req({ parametros: { bit: 4, palabra_bits: 16 } }),
      res,
      vi.fn(),
    );

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(seActualizo()).toBe(true);
  });

  it('impide mover un bit encima de otro ya usado', async () => {
    mapeoActual = bitGuardado('RM1', 'Marcha bomba 1', 0);
    mapeosExistentes = [bitGuardado('RM2', 'Falla termico', 1)];
    const res = makeRes();

    await controller.updateSiteVariableMap(
      req({ parametros: { bit: 1, palabra_bits: 16 } }),
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(errorDe(res)).toContain('Falla termico');
    expect(seActualizo()).toBe(false);
  });

  it('el chequeo excluye el propio mapeo: reguardar el mismo bit no choca', async () => {
    mapeoActual = bitGuardado('RM1', 'Marcha bomba 1', 0);
    mapeosExistentes = [];
    const res = makeRes();

    await controller.updateSiteVariableMap(req({ alias: 'Marcha bomba principal' }), res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(seActualizo()).toBe(true);

    // La exclusion viaja en SQL, no se resuelve en JS: sin `id <> $3` el propio
    // mapeo se veria a si mismo ocupando el bit y todo PATCH daria 409.
    const hermanos = consultas.find((c) => c.sql.includes('AND id <> $3'));
    expect(hermanos?.params).toEqual(['S200', 'REG20', 'RM1']);
  });

  it('rechaza dejar un bit sin indice valido', async () => {
    mapeoActual = bitGuardado('RM1', 'Marcha bomba 1', 0);
    const res = makeRes();

    await controller.updateSiteVariableMap(req({ parametros: { palabra_bits: 16 } }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(seActualizo()).toBe(false);
  });

  it('impide moverle el rol de dashboard a un bit ya guardado', async () => {
    mapeoActual = { ...bitGuardado('RM1', 'Marcha bomba 1', 0), rol_dashboard: 'generico' };
    const res = makeRes();

    await controller.updateSiteVariableMap(req({ rol_dashboard: 'caudal' }), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(seActualizo()).toBe(false);
  });

  it('no revisa colisiones cuando no hay bits ni cambio de d1 (sitios heredados)', async () => {
    mapeoActual = {
      id: 'RM1',
      alias: 'Presion',
      d1: 'REG20',
      transformacion: 'lineal',
      parametros: {},
    };
    // Un duplicado historico sobre el mismo d1 no debe bloquear un cambio de alias.
    mapeosExistentes = [
      { id: 'RM9', alias: 'Presion vieja', d1: 'REG20', transformacion: 'lineal', parametros: {} },
    ];
    const res = makeRes();

    await controller.updateSiteVariableMap(req({ alias: 'Presion de linea' }), res, vi.fn());

    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(seActualizo()).toBe(true);
  });
});
