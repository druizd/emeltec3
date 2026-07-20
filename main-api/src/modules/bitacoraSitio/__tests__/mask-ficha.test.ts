import { describe, it, expect } from 'vitest';
import { maskFichaForRole } from '../mask';
import type { FichaSitio } from '../repo';

const ficha: FichaSitio = {
  pin_critico: 'Acceso con guía DGA',
  contactos: [
    { nombre: 'Juan Pérez', rol: 'Responsable', telefono: '+56 912345678', email: 'juan@x.cl' },
    { nombre: 'Sin datos', rol: 'Operador', telefono: null, email: null },
  ],
  acreditaciones: [],
  riesgos: [],
};

const ROLES_INTERNOS = ['SuperAdmin', 'Admin', 'Vendedor'];
const ROLES_EXTERNOS = ['Cliente', 'Gerente', 'Empresa', 'SubEmpresa'];

describe('maskFichaForRole', () => {
  for (const tipo of ROLES_INTERNOS) {
    it(`rol interno ${tipo}: ve la ficha completa sin enmascarar`, () => {
      const out = maskFichaForRole(ficha, tipo);
      expect(out.contactos[0].telefono).toBe('+56 912345678');
      expect(out.contactos[0].email).toBe('juan@x.cl');
      expect(out.contactos[0].datos_ocultos).toBeUndefined();
    });
  }

  for (const tipo of ROLES_EXTERNOS) {
    it(`rol externo ${tipo}: recibe tel/email enmascarados`, () => {
      const out = maskFichaForRole(ficha, tipo);
      expect(out.contactos[0].telefono).toBeNull();
      expect(out.contactos[0].email).toBeNull();
      expect(out.contactos[0].datos_ocultos).toBe(true);
      // Nombre y rol NO se enmascaran.
      expect(out.contactos[0].nombre).toBe('Juan Pérez');
      expect(out.contactos[0].rol).toBe('Responsable');
    });
  }

  it('rol desconocido (fail-closed): enmascara por defecto', () => {
    const out = maskFichaForRole(ficha, 'RolNuevo');
    expect(out.contactos[0].telefono).toBeNull();
  });

  it('tipo undefined: enmascara por defecto', () => {
    const out = maskFichaForRole(ficha, undefined);
    expect(out.contactos[0].telefono).toBeNull();
  });

  it('datos_ocultos es false cuando el contacto no tenía tel/email', () => {
    const out = maskFichaForRole(ficha, 'Cliente');
    expect(out.contactos[1].datos_ocultos).toBe(false);
  });
});
