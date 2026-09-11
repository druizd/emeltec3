/**
 * Alcance del serial compartido entre sitios.
 *
 * Un mismo datalogger puede alimentar varias obras: cada sitio tiene su propio
 * reg_map, así que repetir `id_serial` es legítimo. Lo que NO puede cruzar es
 * la subempresa: /api/data/* autoriza por serial (services/dataAccess) y
 * devuelve el jsonb crudo del equipo completo, así que un serial compartido
 * entre subempresas le mostraría a un cliente los registros del otro.
 *
 * El pool se sustituye vía `require.cache`, NO con `vi.mock`: companyController
 * es CommonJS y hace `require('../config/db')`, que pasa por el loader de Node
 * y vitest no parchea. Mismo patrón que alertaController.scope.test.ts.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fila = Record<string, unknown>;

const consultas: { sql: string; params: unknown[] }[] = [];

/** Sitios que ya tienen el serial pedido, según los filtra ensureSerialAvailable. */
let sitiosConSerial: Fila[] = [];
/** Sitio devuelto por getSiteById en las pruebas de updateSite. */
let sitioExistente: Fila | null = null;

function responder(sql: string): { rows: Fila[]; rowCount: number } {
  const rows = (() => {
    if (sql.includes('FROM sub_empresa WHERE id')) return [{ id: 'SE1', empresa_id: 'E1' }];
    if (sql.includes('FROM sitio WHERE id_serial')) return sitiosConSerial;
    if (sql.includes('FROM sitio WHERE id = ')) return sitioExistente ? [sitioExistente] : [];
    if (sql.includes('SELECT id FROM sitio WHERE id LIKE')) return [{ id: 'S140' }];
    if (sql.includes('INSERT INTO sitio')) return [{ id: 'S141', id_serial: '151.2.2.2' }];
    if (sql.startsWith('UPDATE sitio') || sql.includes('\n           SET ')) {
      return [{ id: sitioExistente?.id ?? 'S141' }];
    }
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
  createSite: (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
  updateSite: (req: unknown, res: unknown, next: unknown) => Promise<unknown>;
};

const makeRes = () => {
  const res = {
    status: vi.fn((_code?: number) => res),
    json: vi.fn((_payload?: unknown) => res),
  };
  return res;
};

const superAdmin = { id: 'U1', tipo: 'SuperAdmin' };

/** Sitio con el mismo serial, dentro de la subempresa destino. */
const hermano = { id: 'S140', descripcion: 'Pozo 1', empresa_id: 'E1', sub_empresa_id: 'SE1' };
/** Sitio con el mismo serial, en OTRA subempresa. */
const ajeno = { id: 'S999', descripcion: 'Pozo ajeno', empresa_id: 'E9', sub_empresa_id: 'SE9' };

beforeEach(() => {
  consultas.length = 0;
  sitiosConSerial = [];
  sitioExistente = null;
});

describe('createSite — serial compartido', () => {
  const req = (body: Record<string, unknown> = {}) => ({
    params: { companyId: 'E1', subCompanyId: 'SE1' },
    user: superAdmin,
    body: {
      descripcion: 'Pozo 2',
      id_serial: '151.2.2.2',
      tipo_sitio: 'generico',
      ...body,
    },
  });

  it('acepta un serial ya usado por otro sitio de la MISMA subempresa', async () => {
    // ensureSerialAvailable excluye el alcance en SQL: no hay conflicto.
    sitiosConSerial = [];
    const res = makeRes();

    await controller.createSite(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(201);

    // El filtro de alcance viajó a la consulta, no se resolvió en JS.
    const chequeo = consultas.find((c) => c.sql.includes('FROM sitio WHERE id_serial'));
    expect(chequeo?.sql).toContain('NOT (empresa_id =');
    expect(chequeo?.params).toEqual(['151.2.2.2', 'E1', 'SE1']);
  });

  it('rechaza un serial que ya usa un sitio de otra subempresa', async () => {
    sitiosConSerial = [ajeno];
    const res = makeRes();

    await controller.createSite(req(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = res.json.mock.calls[0]?.[0] as { error: string };
    expect(payload.error).toContain('S999');
    expect(payload.error).toMatch(/misma subempresa/i);
    expect(consultas.some((c) => c.sql.includes('INSERT INTO sitio'))).toBe(false);
  });
});

describe('updateSite — serial compartido', () => {
  it('bloquea mover a otra subempresa un sitio cuyo serial está compartido', async () => {
    sitioExistente = {
      id: 'S141',
      descripcion: 'Pozo 2',
      id_serial: '151.2.2.2',
      empresa_id: 'E1',
      sub_empresa_id: 'SE1',
      tipo_sitio: 'generico',
      activo: true,
      es_maleta_piloto: false,
    };
    // Tras el traslado a SE1... el hermano queda fuera del nuevo alcance.
    sitiosConSerial = [hermano];
    const res = makeRes();

    await controller.updateSite(
      {
        params: { siteId: 'S141' },
        user: superAdmin,
        body: { sub_empresa_id: 'SE2', descripcion: 'Pozo 2 movido' },
      },
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(consultas.some((c) => c.sql.includes('UPDATE sitio'))).toBe(false);
  });

  it('valida el serial actual aunque el body no lo mande', async () => {
    sitioExistente = {
      id: 'S141',
      descripcion: 'Pozo 2',
      id_serial: '151.2.2.2',
      empresa_id: 'E1',
      sub_empresa_id: 'SE1',
      tipo_sitio: 'generico',
      activo: true,
      es_maleta_piloto: false,
    };
    const res = makeRes();

    await controller.updateSite(
      { params: { siteId: 'S141' }, user: superAdmin, body: { descripcion: 'Pozo 2 bis' } },
      res,
      vi.fn(),
    );

    const chequeo = consultas.find((c) => c.sql.includes('FROM sitio WHERE id_serial'));
    expect(chequeo?.params).toEqual(['151.2.2.2', 'S141', 'E1', 'SE1']);
  });
});
