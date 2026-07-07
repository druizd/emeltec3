/**
 * Tests del modelo de autorización — foco en el rol Vendedor (equipo
 * comercial Emeltec): alcance tipo-Admin limitado a SU empresa, nunca global.
 */
import { describe, it, expect } from 'vitest';
import { canReadSite, scopeByTenant, isSuperAdmin, type AuthUser } from '../permissions';

const EMELTEC = 'E001';
const CLIENTE = 'E999';

const vendedor: AuthUser = { id: 'U1', tipo: 'Vendedor', empresa_id: EMELTEC };

describe('Vendedor — canReadSite', () => {
  it('accede a sitios de su empresa (Emeltec, demos)', () => {
    expect(canReadSite(vendedor, { empresa_id: EMELTEC, sub_empresa_id: 'S1' })).toBe(true);
  });

  it('NO accede a sitios de empresas cliente', () => {
    expect(canReadSite(vendedor, { empresa_id: CLIENTE, sub_empresa_id: null })).toBe(false);
  });

  it('ignora sub_empresa (alcance empresa completa, como Admin)', () => {
    const conSub: AuthUser = { ...vendedor, sub_empresa_id: 'SE9' };
    expect(canReadSite(conSub, { empresa_id: EMELTEC, sub_empresa_id: 'OTRA' })).toBe(true);
  });
});

describe('Vendedor — scopeByTenant', () => {
  it('filtra por su empresa, sin filtro de sub-empresa', () => {
    expect(scopeByTenant(vendedor)).toEqual({ empresaIds: [EMELTEC], subEmpresaIds: null });
  });

  it('sin empresa asignada → sin acceso (lista vacía, no global)', () => {
    const huerfano: AuthUser = { id: 'U2', tipo: 'Vendedor' };
    expect(scopeByTenant(huerfano).empresaIds).toEqual([]);
  });
});

describe('Vendedor — no es SuperAdmin', () => {
  it('isSuperAdmin false', () => {
    expect(isSuperAdmin(vendedor)).toBe(false);
  });
});

describe('regresión — roles existentes intactos', () => {
  it('SuperAdmin sigue global', () => {
    expect(scopeByTenant({ tipo: 'SuperAdmin' })).toEqual({
      empresaIds: null,
      subEmpresaIds: null,
    });
  });

  it('Gerente con sub-empresa sigue estricto a su sub', () => {
    const g: AuthUser = { tipo: 'Gerente', empresa_id: CLIENTE, sub_empresa_id: 'SE1' };
    expect(canReadSite(g, { empresa_id: CLIENTE, sub_empresa_id: 'SE2' })).toBe(false);
    expect(canReadSite(g, { empresa_id: CLIENTE, sub_empresa_id: 'SE1' })).toBe(true);
  });
});
