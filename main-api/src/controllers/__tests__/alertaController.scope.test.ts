/**
 * Alcance de las consultas de alarmas. Cubre los dos defectos corregidos:
 *   1. `visible_to_all` / `viewer_user_ids` se guardaban desde el formulario
 *      pero no filtraban en ninguna consulta: una regla "Restringida" la veía
 *      todo el mundo igual.
 *   2. `resumen` y `listarEventos` filtraban a mano por empresa/sub-empresa en
 *      vez de usar `buildUserSiteScope` como `listarAlertas`. Para un Vendedor
 *      los dos criterios daban conjuntos distintos: la campana le mostraba
 *      sitios de su empresa no asignados y le ocultaba maletas piloto de otras.
 *
 * El pool se sustituye vía `require.cache`, NO con `vi.mock`: alertaController
 * es CommonJS y hace `require('../config/db')`, que pasa por el loader de Node
 * y vitest no parchea — verificado, intentaba conectarse a timescaledb real.
 * Mismo patrón (y mismo motivo) que internalController.fallo.test.ts.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consultas: { sql: string; params: unknown[] }[] = [];

const poolFalso = {
  query: async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    return { rows: [{ count: '0' }] };
  },
};

const require_ = createRequire(path.join(process.cwd(), 'vitest-require-root.js'));

const dbPath = require_.resolve('./src/config/db');
require_.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: poolFalso,
} as unknown as NodeJS.Module;

const controller = require_('./src/controllers/alertaController') as {
  buildAlarmVisibilityScope: (
    user: { id: string; tipo: string } | null,
    alias?: string,
    startIndex?: number,
  ) => { clause: string; params: unknown[] };
  resumen: (req: unknown, res: unknown) => Promise<void>;
  listarEventos: (req: unknown, res: unknown) => Promise<void>;
};

const makeRes = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis() });
const sqls = () => consultas.map((c) => c.sql);

beforeEach(() => {
  consultas.length = 0;
});

describe('buildAlarmVisibilityScope', () => {
  it('no restringe a los roles que administran alarmas', () => {
    for (const tipo of ['SuperAdmin', 'Admin', 'Gerente', 'Vendedor']) {
      const scope = controller.buildAlarmVisibilityScope({ id: 'U1', tipo });
      expect(scope.clause, `${tipo} no debería filtrarse`).toBe('');
      expect(scope.params).toEqual([]);
    }
  });

  it('restringe a los roles no editores según visible_to_all', () => {
    const scope = controller.buildAlarmVisibilityScope({ id: 'U9', tipo: 'Cliente' }, 'a', 3);

    expect(scope.clause).toContain('a.visible_to_all = TRUE');
    expect(scope.clause).toContain('a.creado_por = $3');
    expect(scope.clause).toContain('$3 = ANY(a.viewer_user_ids)');
    expect(scope.params).toEqual(['U9']);
  });

  it('respeta el alias y el índice de placeholder recibidos', () => {
    const scope = controller.buildAlarmVisibilityScope({ id: 'U9', tipo: 'Cliente' }, 'alr', 7);
    expect(scope.clause).toContain('alr.visible_to_all');
    expect(scope.clause).toContain('$7');
    expect(scope.clause).not.toContain('$1');
  });
});

describe('resumen — alcance', () => {
  it('un Cliente filtra por sitio accesible Y por visibilidad de la regla', async () => {
    const req = {
      user: { id: 'U9', tipo: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'SE1' },
      query: {},
    };
    await controller.resumen(req, makeRes());

    expect(sqls().length).toBe(2); // contadores + recientes
    for (const sql of sqls()) {
      // Alcance por sitio, no el filtro manual por empresa que había antes.
      expect(sql).toContain('JOIN sitio s');
      expect(sql).toContain('s.empresa_id');
      expect(sql).toContain('s.sub_empresa_id');
      // Visibilidad de la regla.
      expect(sql).toContain('JOIN alertas a');
      expect(sql).toContain('visible_to_all');
    }
    // El id del usuario viaja como parámetro, nunca interpolado.
    expect(consultas[0].params).toContain('U9');
  });

  it('un Vendedor usa su alcance real: maletas piloto + sitios asignados', async () => {
    const req = {
      user: { id: 'V1', tipo: 'Vendedor', empresa_id: 'E-EMELTEC', sub_empresa_id: null },
      query: {},
    };
    await controller.resumen(req, makeRes());

    const [sql] = sqls();
    expect(sql).toContain('es_maleta_piloto');
    expect(sql).toContain('usuario_sitio');
    // Es editor de alarmas: no se le aplica el filtro de visibilidad.
    expect(sql).not.toContain('visible_to_all');
  });

  it('un SuperAdmin no lleva filtro de alcance ni de visibilidad', async () => {
    await controller.resumen({ user: { id: 'SA1', tipo: 'SuperAdmin' }, query: {} }, makeRes());

    const [sql] = sqls();
    expect(sql).not.toContain('visible_to_all');
    expect(sql).not.toContain('es_maleta_piloto');
  });

  it('un rol desconocido no ve nada', async () => {
    const req = { user: { id: 'X1', tipo: 'Fantasma', empresa_id: 'E1' }, query: {} };
    await controller.resumen(req, makeRes());

    expect(sqls()[0]).toContain('FALSE');
  });
});

describe('listarEventos — alcance', () => {
  it('el COUNT usa los mismos JOINs que la consulta principal', async () => {
    const req = {
      user: { id: 'U9', tipo: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'SE1' },
      query: {},
    };
    await controller.listarEventos(req, makeRes());

    const countSql = sqls().find((s) => s.includes('COUNT(*)'));
    expect(countSql).toBeDefined();
    // Sin estos JOINs, el WHERE referenciaría alias inexistentes y reventaría.
    expect(countSql).toContain('JOIN alertas a');
    expect(countSql).toContain('JOIN sitio s');
  });

  it('aplica el mismo alcance que resumen', async () => {
    const req = {
      user: { id: 'V1', tipo: 'Vendedor', empresa_id: 'E-EMELTEC', sub_empresa_id: null },
      query: {},
    };
    await controller.listarEventos(req, makeRes());

    for (const sql of sqls()) {
      expect(sql).toContain('es_maleta_piloto');
    }
  });
});
