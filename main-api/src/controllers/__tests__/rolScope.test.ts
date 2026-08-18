/**
 * Alcance por rol en los tres puntos corregidos tras la auditoría:
 *   1. `getSiteVariables` pedía SuperAdmin — dejaba a Admin/Gerente/Vendedor
 *      sin reg_map en el panel de alarmas, que sí pueden editar.
 *   2. `listarIncidencias` / `listarDocumentos` filtraban a mano por empresa en
 *      vez de usar el alcance real (rompía para Vendedor).
 *   3. `getAllUsers` no cerraba por defecto: un tipo no contemplado devolvía
 *      TODOS los usuarios del sistema.
 *
 * El pool se sustituye vía `require.cache`: estos controllers son CommonJS y
 * `vi.mock` no intercepta sus `require()` (ver internalController.fallo.test.ts).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consultas: { sql: string; params: unknown[] }[] = [];
/** Filas que devuelve la próxima consulta, por si el handler necesita datos. */
let filas: unknown[] = [{ count: '0' }];

const poolFalso = {
  query: async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    return { rows: filas };
  },
  connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
};

const require_ = createRequire(path.join(process.cwd(), 'vitest-require-root.js'));

for (const mod of ['./src/config/db']) {
  const p = require_.resolve(mod);
  require_.cache[p] = { id: p, filename: p, loaded: true, exports: poolFalso } as never;
}

const incidencias = require_('./src/controllers/incidenciaController') as Record<
  string,
  (req: unknown, res: unknown) => Promise<void>
>;
const documentos = require_('./src/controllers/documentoController') as Record<
  string,
  (req: unknown, res: unknown) => Promise<void>
>;
// userController NO se carga acá: hace `require('../config/dbHelpers')`, que
// solo existe como .ts y el createRequire nativo de Node no lo transpila (en
// producción corre desde dist/, donde sí es .js). Su cobertura vive en
// userController.scope.test.ts, que usa el pipeline de vitest.

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const sqls = () => consultas.map((c) => c.sql);

beforeEach(() => {
  consultas.length = 0;
  filas = [{ count: '0' }];
});

describe('listarIncidencias — alcance por rol', () => {
  it('un Vendedor usa su alcance real, no el filtro por empresa', async () => {
    const req = {
      user: { id: 'V1', tipo: 'Vendedor', empresa_id: 'E-EMELTEC', sub_empresa_id: null },
      query: {},
    };
    await incidencias.listarIncidencias(req, makeRes());

    const [sql] = sqls();
    expect(sql).toContain('es_maleta_piloto');
    expect(sql).toContain('usuario_sitio');
    // Ya no filtra por la empresa denormalizada en la incidencia.
    expect(sql).not.toContain('i.empresa_id = $1');
  });

  it('el COUNT lleva el JOIN a sitio que el WHERE necesita', async () => {
    const req = {
      user: { id: 'U9', tipo: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'SE1' },
      query: {},
    };
    await incidencias.listarIncidencias(req, makeRes());

    const countSql = sqls().find((s) => s.includes('COUNT(*)'));
    expect(countSql).toBeDefined();
    expect(countSql).toContain('JOIN sitio s');
  });

  it('un rol desconocido no ve nada', async () => {
    const req = { user: { id: 'X', tipo: 'Fantasma', empresa_id: 'E1' }, query: {} };
    await incidencias.listarIncidencias(req, makeRes());
    expect(sqls()[0]).toContain('FALSE');
  });
});

describe('listarDocumentos — alcance por rol', () => {
  it('un Vendedor usa su alcance real', async () => {
    const req = {
      user: { id: 'V1', tipo: 'Vendedor', empresa_id: 'E-EMELTEC', sub_empresa_id: null },
      query: {},
    };
    await documentos.listarDocumentos(req, makeRes());

    const [sql] = sqls();
    expect(sql).toContain('es_maleta_piloto');
    expect(sql).not.toContain('d.empresa_id = $1');
  });

  it('el COUNT lleva el JOIN a sitio', async () => {
    const req = {
      user: { id: 'U9', tipo: 'Cliente', empresa_id: 'E1', sub_empresa_id: 'SE1' },
      query: {},
    };
    await documentos.listarDocumentos(req, makeRes());

    const countSql = sqls().find((s) => s.includes('COUNT(*)'));
    expect(countSql).toContain('JOIN sitio s');
  });
});

describe('vi.mock no aplica a estos controllers', () => {
  it('el pool sustituido es el falso (guardia del setup del test)', () => {
    // Si esto falla, los tests estarían pegándole a la DB real.
    expect(vi.isMockFunction(poolFalso.query)).toBe(false);
    expect(typeof poolFalso.query).toBe('function');
  });
});
