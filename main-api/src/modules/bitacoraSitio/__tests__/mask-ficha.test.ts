import { describe, it, expect } from 'vitest';
import { maskFicha } from '../mask';
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

function primerContacto() {
  const c = maskFicha(ficha).contactos[0];
  if (!c) throw new Error('fixture sin contactos');
  return c;
}

describe('maskFicha', () => {
  it('enmascara tel/email de todos los contactos (para cualquier rol)', () => {
    const c = primerContacto();
    expect(c.telefono).toBeNull();
    expect(c.email).toBeNull();
  });

  it('marca datos_ocultos=true cuando el contacto tenía tel/email', () => {
    expect(primerContacto().datos_ocultos).toBe(true);
  });

  it('datos_ocultos=false cuando el contacto no tenía tel/email', () => {
    const c = maskFicha(ficha).contactos[1];
    expect(c?.datos_ocultos).toBe(false);
  });

  it('preserva nombre y rol (no son datos de contacto revelables)', () => {
    const c = primerContacto();
    expect(c.nombre).toBe('Juan Pérez');
    expect(c.rol).toBe('Responsable');
  });

  it('no muta la ficha original', () => {
    maskFicha(ficha);
    expect(ficha.contactos[0]?.telefono).toBe('+56 912345678');
  });

  it('preserva pin_critico, acreditaciones y riesgos', () => {
    const out = maskFicha(ficha);
    expect(out.pin_critico).toBe('Acceso con guía DGA');
    expect(out.acreditaciones).toEqual([]);
    expect(out.riesgos).toEqual([]);
  });
});
