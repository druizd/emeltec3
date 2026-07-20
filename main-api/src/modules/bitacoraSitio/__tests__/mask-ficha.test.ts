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

/** Primer contacto de la ficha enmascarada según rol (siempre existe en el fixture). */
function primerContacto(tipo: string | undefined) {
  const c = maskFichaForRole(ficha, tipo).contactos[0];
  if (!c) throw new Error('fixture sin contactos');
  return c;
}

describe('maskFichaForRole', () => {
  for (const tipo of ROLES_INTERNOS) {
    it(`rol interno ${tipo}: ve la ficha completa sin enmascarar`, () => {
      const c = primerContacto(tipo);
      expect(c.telefono).toBe('+56 912345678');
      expect(c.email).toBe('juan@x.cl');
      expect(c.datos_ocultos).toBeUndefined();
    });
  }

  for (const tipo of ROLES_EXTERNOS) {
    it(`rol externo ${tipo}: recibe tel/email enmascarados`, () => {
      const c = primerContacto(tipo);
      expect(c.telefono).toBeNull();
      expect(c.email).toBeNull();
      expect(c.datos_ocultos).toBe(true);
      // Nombre y rol NO se enmascaran.
      expect(c.nombre).toBe('Juan Pérez');
      expect(c.rol).toBe('Responsable');
    });
  }

  it('rol desconocido (fail-closed): enmascara por defecto', () => {
    expect(primerContacto('RolNuevo').telefono).toBeNull();
  });

  it('tipo undefined: enmascara por defecto', () => {
    expect(primerContacto(undefined).telefono).toBeNull();
  });

  it('datos_ocultos es false cuando el contacto no tenía tel/email', () => {
    const c = maskFichaForRole(ficha, 'Cliente').contactos[1];
    expect(c?.datos_ocultos).toBe(false);
  });
});
