/**
 * Tests del control de acceso a datos por serial/sitio (modelo estricto).
 * Funciones puras + funciones con `pool` inyectado (pool falso, sin BD real).
 */
import { describe, it, expect } from 'vitest';
import {
  canAccessSite,
  buildUserSiteScope,
  userCanAccessSerial,
  getLatestSerialForUser,
  resolveAccessibleSerial,
  findUnauthorizedSites,
  userCanAccessSiteId,
} from '../dataAccess';

const superAdmin = { tipo: 'SuperAdmin' };
const admin = { tipo: 'Admin', empresa_id: 1 };
const gerente = { tipo: 'Gerente', empresa_id: 1, sub_empresa_id: 10 };
const cliente = { tipo: 'Cliente', empresa_id: 1, sub_empresa_id: 10 };
// Sin sub-empresa asignada → acceso a toda la empresa (decisión jun-2026).
const clienteSinSub = { tipo: 'Cliente', empresa_id: 1, sub_empresa_id: null };
const gerenteSinSub = { tipo: 'Gerente', empresa_id: 1 }; // sub_empresa_id undefined

type Handler = { match: RegExp; respond: (params: any) => { rows: any[] } };
function fakePool(handlers: Handler[]) {
  return {
    query: async (sql: string, params: any) => {
      for (const h of handlers) {
        if (h.match.test(sql)) return h.respond(params);
      }
      return { rows: [] };
    },
  };
}

describe('canAccessSite', () => {
  it('SuperAdmin accede a cualquier sitio (incluso null)', () => {
    expect(canAccessSite(superAdmin, null)).toBe(true);
    expect(canAccessSite(superAdmin, { empresa_id: 99, sub_empresa_id: 99 })).toBe(true);
  });
  it('Admin: solo su empresa', () => {
    expect(canAccessSite(admin, { empresa_id: 1, sub_empresa_id: 10 })).toBe(true);
    expect(canAccessSite(admin, { empresa_id: 2, sub_empresa_id: 10 })).toBe(false);
  });
  it('Gerente/Cliente CON sub-empresa: empresa Y sub-empresa (estricto)', () => {
    expect(canAccessSite(gerente, { empresa_id: 1, sub_empresa_id: 10 })).toBe(true);
    expect(canAccessSite(gerente, { empresa_id: 1, sub_empresa_id: 11 })).toBe(false);
    expect(canAccessSite(cliente, { empresa_id: 1, sub_empresa_id: 10 })).toBe(true);
    expect(canAccessSite(cliente, { empresa_id: 1, sub_empresa_id: 11 })).toBe(false);
  });
  it('Gerente/Cliente SIN sub-empresa: ve toda su empresa', () => {
    // null, undefined y '' cuentan como "sin sub-empresa".
    for (const u of [
      clienteSinSub,
      gerenteSinSub,
      { tipo: 'Cliente', empresa_id: 1, sub_empresa_id: '' },
    ]) {
      expect(canAccessSite(u, { empresa_id: 1, sub_empresa_id: 10 })).toBe(true);
      expect(canAccessSite(u, { empresa_id: 1, sub_empresa_id: 20 })).toBe(true);
      expect(canAccessSite(u, { empresa_id: 1, sub_empresa_id: null })).toBe(true);
      // Pero NO otra empresa.
      expect(canAccessSite(u, { empresa_id: 2, sub_empresa_id: 10 })).toBe(false);
    }
  });
  it('rol desconocido o sin usuario: false', () => {
    expect(
      canAccessSite({ tipo: 'Otro', empresa_id: 1 }, { empresa_id: 1, sub_empresa_id: 1 }),
    ).toBe(false);
    expect(canAccessSite(null, { empresa_id: 1, sub_empresa_id: 1 })).toBe(false);
  });
});

describe('buildUserSiteScope', () => {
  it('SuperAdmin: sin filtro', () => {
    expect(buildUserSiteScope(superAdmin)).toEqual({ clause: '', params: [] });
  });
  it('Admin: filtra por empresa', () => {
    expect(buildUserSiteScope(admin)).toEqual({ clause: 's.empresa_id = $1', params: [1] });
  });
  it('Cliente/Gerente: filtra por empresa y sub-empresa', () => {
    const scope = buildUserSiteScope(cliente);
    expect(scope.params).toEqual([1, 10]);
    expect(scope.clause).toContain('empresa_id = $1');
    expect(scope.clause).toContain('sub_empresa_id = $2');
  });
  it('startIndex desplaza los placeholders (composición con params previos)', () => {
    expect(buildUserSiteScope(admin, 's', 3)).toEqual({ clause: 's.empresa_id = $3', params: [1] });
    const scope = buildUserSiteScope(cliente, 'x', 2);
    expect(scope.clause).toBe('x.empresa_id = $2 AND x.sub_empresa_id = $3');
    expect(scope.params).toEqual([1, 10]);
  });
  it('Cliente/Gerente SIN sub-empresa: filtra solo por empresa', () => {
    expect(buildUserSiteScope(clienteSinSub)).toEqual({ clause: 's.empresa_id = $1', params: [1] });
    expect(buildUserSiteScope(gerenteSinSub)).toEqual({ clause: 's.empresa_id = $1', params: [1] });
  });
  it('rol desconocido: cláusula imposible (FALSE), sin params', () => {
    expect(buildUserSiteScope({ tipo: 'Otro' })).toEqual({ clause: 'FALSE', params: [] });
  });
});

describe('userCanAccessSerial', () => {
  it('SuperAdmin: true sin consultar BD', async () => {
    const pool = fakePool([]);
    expect(await userCanAccessSerial(pool, superAdmin, 'S1')).toBe(true);
  });
  it('serial de su sub-empresa: true', async () => {
    const pool = fakePool([
      {
        match: /FROM sitio WHERE id_serial/,
        respond: () => ({ rows: [{ empresa_id: 1, sub_empresa_id: 10 }] }),
      },
    ]);
    expect(await userCanAccessSerial(pool, cliente, 'S1')).toBe(true);
  });
  it('serial de otra sub-empresa: false', async () => {
    const pool = fakePool([
      {
        match: /FROM sitio WHERE id_serial/,
        respond: () => ({ rows: [{ empresa_id: 1, sub_empresa_id: 11 }] }),
      },
    ]);
    expect(await userCanAccessSerial(pool, cliente, 'S1')).toBe(false);
  });
  it('serial no mapeado a ningún sitio: false', async () => {
    const pool = fakePool([{ match: /FROM sitio WHERE id_serial/, respond: () => ({ rows: [] }) }]);
    expect(await userCanAccessSerial(pool, cliente, 'X')).toBe(false);
  });
});

describe('getLatestSerialForUser', () => {
  it('devuelve el último serial del alcance del usuario', async () => {
    const pool = fakePool([
      {
        match: /FROM equipo e[\s\S]*JOIN sitio s/,
        respond: (p) => {
          expect(p).toEqual([1, 10]); // scope cliente
          return { rows: [{ id_serial: 'MINE' }] };
        },
      },
    ]);
    expect(await getLatestSerialForUser(pool, cliente)).toBe('MINE');
  });
  it('null si no tiene equipos', async () => {
    const pool = fakePool([{ match: /FROM equipo/, respond: () => ({ rows: [] }) }]);
    expect(await getLatestSerialForUser(pool, cliente)).toBe(null);
  });
});

describe('resolveAccessibleSerial', () => {
  it('serial pedido y propio → lo devuelve', async () => {
    const pool = fakePool([
      {
        match: /FROM sitio WHERE id_serial/,
        respond: () => ({ rows: [{ empresa_id: 1, sub_empresa_id: 10 }] }),
      },
    ]);
    expect(await resolveAccessibleSerial(pool, cliente, 'S1')).toEqual({ serial: 'S1' });
  });
  it('serial pedido ajeno → forbidden', async () => {
    const pool = fakePool([
      {
        match: /FROM sitio WHERE id_serial/,
        respond: () => ({ rows: [{ empresa_id: 2, sub_empresa_id: 99 }] }),
      },
    ]);
    expect(await resolveAccessibleSerial(pool, cliente, 'S1')).toEqual({ forbidden: true });
  });
  it('sin serial → último del usuario', async () => {
    const pool = fakePool([
      { match: /FROM equipo/, respond: () => ({ rows: [{ id_serial: 'MINE' }] }) },
    ]);
    expect(await resolveAccessibleSerial(pool, cliente, null)).toEqual({ serial: 'MINE' });
  });
});

describe('userCanAccessSiteId', () => {
  const poolWith = (site: unknown) =>
    fakePool([
      { match: /FROM sitio WHERE id = \$1/, respond: () => ({ rows: site ? [site] : [] }) },
    ]);

  it('SuperAdmin: true sin consultar BD', async () => {
    expect(await userCanAccessSiteId(fakePool([]), superAdmin, 'S1')).toBe(true);
  });
  it('Cliente: sitio de su sub-empresa → true', async () => {
    expect(
      await userCanAccessSiteId(poolWith({ empresa_id: 1, sub_empresa_id: 10 }), cliente, 'S1'),
    ).toBe(true);
  });
  it('Cliente: sitio de otra sub-empresa → false', async () => {
    expect(
      await userCanAccessSiteId(poolWith({ empresa_id: 1, sub_empresa_id: 20 }), cliente, 'S1'),
    ).toBe(false);
  });
  it('sitio inexistente → false', async () => {
    expect(await userCanAccessSiteId(poolWith(null), cliente, 'X')).toBe(false);
  });
});

describe('findUnauthorizedSites', () => {
  // Mapa de sitios: S10/S11 sub-empresa 10, S20 sub-empresa 20, S99 inexistente.
  const lookup = async (id: string) =>
    ({
      S10: { empresa_id: 1, sub_empresa_id: 10 },
      S11: { empresa_id: 1, sub_empresa_id: 10 },
      S20: { empresa_id: 1, sub_empresa_id: 20 },
    })[id] || null;

  it('Cliente: deniega sitios de otra sub-empresa', async () => {
    expect(await findUnauthorizedSites(['S10', 'S11', 'S20'], cliente, lookup)).toEqual(['S20']);
  });
  it('Cliente: deniega sitios inexistentes', async () => {
    expect(await findUnauthorizedSites(['S10', 'S99'], cliente, lookup)).toEqual(['S99']);
  });
  it('todos accesibles → lista vacía', async () => {
    expect(await findUnauthorizedSites(['S10', 'S11'], cliente, lookup)).toEqual([]);
  });
  it('SuperAdmin: nunca deniega (ni inexistentes)', async () => {
    expect(await findUnauthorizedSites(['S20', 'S99'], superAdmin, lookup)).toEqual([]);
  });
  it('Cliente sin sub-empresa: accede a toda la empresa (S20 incluido)', async () => {
    expect(await findUnauthorizedSites(['S10', 'S20'], clienteSinSub, lookup)).toEqual([]);
    // Pero sigue denegando inexistentes (no se puede verificar empresa).
    expect(await findUnauthorizedSites(['S10', 'S99'], clienteSinSub, lookup)).toEqual(['S99']);
  });
});
