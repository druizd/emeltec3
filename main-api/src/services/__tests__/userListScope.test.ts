/**
 * `buildUserListScope` debe CERRAR por defecto.
 *
 * Antes esta lógica era un if/else dentro de getAllUsers y un tipo NO
 * contemplado no entraba en ningún branch: `conditions` quedaba vacío, la
 * consulta salía sin WHERE y devolvía todos los usuarios del sistema (nombre,
 * email, RUT, cargo) de todas las empresas. `usuario.tipo` es VARCHAR(30) SIN
 * CHECK en el esquema, así que un typo o un rol nuevo lo activaba.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildUserListScope } = require('../userListScope.js') as {
  buildUserListScope: (
    user: { tipo?: string; empresa_id?: string; sub_empresa_id?: string | null } | null,
    filtros?: { sub_empresa_id?: string; empresa_id?: string },
  ) => { allow: boolean; empty?: boolean; conditions?: string[]; params?: unknown[] };
};

describe('buildUserListScope — cierra por defecto', () => {
  it('deniega un tipo no contemplado', () => {
    for (const tipo of ['admin', 'Auditor', 'ADMIN', 'tecnico', '']) {
      expect(buildUserListScope({ tipo, empresa_id: 'E1' }).allow, tipo).toBe(false);
    }
  });

  it('deniega si no hay usuario o no trae tipo', () => {
    expect(buildUserListScope(null).allow).toBe(false);
    expect(buildUserListScope({ empresa_id: 'E1' }).allow).toBe(false);
  });

  it('deniega a Cliente', () => {
    expect(buildUserListScope({ tipo: 'Cliente', empresa_id: 'E1' }).allow).toBe(false);
  });
});

describe('buildUserListScope — alcance por rol', () => {
  it('SuperAdmin sin filtros no restringe', () => {
    const scope = buildUserListScope({ tipo: 'SuperAdmin' });
    expect(scope.allow).toBe(true);
    expect(scope.conditions).toEqual([]);
    expect(scope.params).toEqual([]);
  });

  it('SuperAdmin puede acotar por empresa o división desde el query', () => {
    expect(buildUserListScope({ tipo: 'SuperAdmin' }, { empresa_id: 'E7' }).params).toEqual(['E7']);
    const porDivision = buildUserListScope({ tipo: 'SuperAdmin' }, { sub_empresa_id: 'SE3' });
    expect(porDivision.conditions).toEqual(['u.sub_empresa_id = $1']);
  });

  it('Admin queda acotado a su empresa', () => {
    const scope = buildUserListScope({ tipo: 'Admin', empresa_id: 'E1', sub_empresa_id: null });
    expect(scope.conditions).toEqual(['u.empresa_id = $1']);
    expect(scope.params).toEqual(['E1']);
  });

  it('Admin con división también se acota a ella', () => {
    const scope = buildUserListScope({ tipo: 'Admin', empresa_id: 'E1', sub_empresa_id: 'SE1' });
    expect(scope.conditions).toEqual(['u.empresa_id = $1', 'u.sub_empresa_id = $2']);
    expect(scope.params).toEqual(['E1', 'SE1']);
  });

  it('Vendedor se trata como Admin de su empresa', () => {
    const scope = buildUserListScope({ tipo: 'Vendedor', empresa_id: 'E-EMELTEC' });
    expect(scope.allow).toBe(true);
    expect(scope.params).toEqual(['E-EMELTEC']);
  });

  it('Gerente sin división devuelve vacío en vez de todo', () => {
    const scope = buildUserListScope({ tipo: 'Gerente', empresa_id: 'E1', sub_empresa_id: null });
    expect(scope.allow).toBe(true);
    expect(scope.empty).toBe(true);
  });

  it('Gerente con división se acota a ella', () => {
    const scope = buildUserListScope({ tipo: 'Gerente', empresa_id: 'E1', sub_empresa_id: 'SE2' });
    expect(scope.conditions).toEqual(['u.sub_empresa_id = $1']);
    expect(scope.params).toEqual(['SE2']);
  });

  it('un rol no-SuperAdmin nunca queda sin condiciones', () => {
    // La invariante que se rompía: allow=true con conditions vacío ⇒ sin WHERE.
    for (const tipo of ['Admin', 'Vendedor', 'Gerente']) {
      const scope = buildUserListScope({ tipo, empresa_id: 'E1', sub_empresa_id: 'SE1' });
      if (scope.empty) continue;
      expect(scope.conditions?.length, tipo).toBeGreaterThan(0);
    }
  });
});
