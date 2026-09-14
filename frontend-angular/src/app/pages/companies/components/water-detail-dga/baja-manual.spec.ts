/**
 * Cómo se le explica al cliente una medición dada de baja.
 *
 * En la base los dos casos son `estatus = 'fallido'`, pero significan cosas
 * opuestas: una medición que agotó sus reintentos contra SNIA es una falla del
 * envío, y una que un operador cerró con motivo es una decisión documentada.
 *
 * Mostrar las dos como "Fallido — reintentos agotados" describe algo que no
 * ocurrió, y es justo lo que el cliente ve cuando un recambio de instrumento le
 * deja 211 mediciones cerradas (S130, septiembre 2026). El prefijo `baja_` en
 * `fail_reason` es lo único que las distingue.
 */
import { esBajaManual, motivoBajaLabel, MOTIVO_BAJA_LABEL } from './baja-manual';

describe('esBajaManual', () => {
  it('reconoce una baja hecha por un operador', () => {
    expect(esBajaManual('fallido', 'baja_recambio_instrumento')).toBe(true);
    expect(esBajaManual('fallido', 'baja_sin_dato_crudo')).toBe(true);
    expect(esBajaManual('fallido', 'baja_otro')).toBe(true);
  });

  it('un fallido por reintentos agotados NO es una baja manual', () => {
    // Este sí es una falla del envío y tiene que seguir leyéndose como tal.
    expect(esBajaManual('fallido', 'network_error')).toBe(false);
    expect(esBajaManual('fallido', 'unknown_failure')).toBe(false);
    expect(esBajaManual('fallido', null)).toBe(false);
    expect(esBajaManual('fallido', undefined)).toBe(false);
  });

  it('ningún otro estado se confunde con una baja', () => {
    // `fail_reason` sobrevive a un recálculo en algunos caminos, así que el
    // estado tiene que entrar en la condición y no sólo el motivo.
    expect(esBajaManual('enviado', 'baja_recambio_instrumento')).toBe(false);
    expect(esBajaManual('pendiente', 'baja_recambio_instrumento')).toBe(false);
    expect(esBajaManual('requires_review', 'baja_recambio_instrumento')).toBe(false);
  });

  it('no confunde un motivo que sólo contiene la palabra', () => {
    // El prefijo es `baja_` al INICIO; un código que la lleve en medio no
    // convierte una falla en decisión.
    expect(esBajaManual('fallido', 'error_baja_tension')).toBe(false);
  });
});

describe('motivoBajaLabel', () => {
  it('explica cada motivo en el idioma del cliente, sin jerga', () => {
    for (const [code, label] of Object.entries(MOTIVO_BAJA_LABEL)) {
      expect(label.length).toBeGreaterThan(20);
      // El cliente no tiene por qué leer el código interno.
      expect(label).not.toContain(code);
      expect(label).not.toContain('fail_reason');
      expect(label).not.toContain('slot');
    }
  });

  it('el recambio de instrumento dice por qué no hay dato', () => {
    const label = motivoBajaLabel('baja_recambio_instrumento');
    expect(label).toContain('recambio de instrumento');
    expect(label).toContain('no hay dato que declarar');
  });

  it('un motivo desconocido cae a un texto genérico, nunca a vacío', () => {
    // Si mañana se agrega un motivo en el backend y no acá, el cliente tiene
    // que ver algo que se entienda igual.
    const label = motivoBajaLabel('baja_motivo_nuevo');
    expect(label).toContain('Período cerrado por el operador');
    expect(label.length).toBeGreaterThan(20);
  });

  it('nunca devuelve vacío, ni con null', () => {
    expect(motivoBajaLabel(null).length).toBeGreaterThan(0);
    expect(motivoBajaLabel(undefined).length).toBeGreaterThan(0);
    expect(motivoBajaLabel('').length).toBeGreaterThan(0);
  });
});
