import { describe, it, expect } from 'vitest';
import { diaSemanaDeFecha, diaSemanaDeInstante, esDiaActivo } from './alerta-dias';

/**
 * El tester de reglas descarta las lecturas de los días que la regla no
 * tiene activos. El día se decide en hora de Chile, como hace el worker.
 */
describe('alerta-dias', () => {
  it('convierte un instante UTC al día de la semana en hora de Chile', () => {
    // Sábado 2026-08-29 02:30Z es todavía viernes 22:30 en Chile (UTC-4).
    expect(diaSemanaDeInstante('2026-08-29T02:30:00Z')).toBe('viernes');
    // Sábado 2026-08-29 12:00Z es sábado en Chile.
    expect(diaSemanaDeInstante('2026-08-29T12:00:00Z')).toBe('sabado');
    // Domingo 2026-08-30 03:59Z sigue siendo sábado en Chile.
    expect(diaSemanaDeInstante('2026-08-30T03:59:00Z')).toBe('sabado');
    expect(diaSemanaDeInstante('2026-08-30T04:00:00Z')).toBe('domingo');
  });

  it('devuelve null para un timestamp que no se puede interpretar', () => {
    expect(diaSemanaDeInstante('no-es-fecha')).toBeNull();
    expect(diaSemanaDeInstante('')).toBeNull();
  });

  it('convierte una fecha calendario sin aplicar zona horaria', () => {
    expect(diaSemanaDeFecha('2026-08-29')).toBe('sabado');
    expect(diaSemanaDeFecha('2026-08-30')).toBe('domingo');
    expect(diaSemanaDeFecha('2026-08-31')).toBe('lunes');
    expect(diaSemanaDeFecha('2026-08-31T12:00:00Z')).toBe('lunes');
    expect(diaSemanaDeFecha('31/08/2026')).toBeNull();
  });

  it('sin días configurados la regla corre siempre, como el worker', () => {
    expect(esDiaActivo('lunes', [])).toBe(true);
    expect(esDiaActivo('lunes', ['sabado', 'domingo'])).toBe(false);
    expect(esDiaActivo('sabado', ['sabado', 'domingo'])).toBe(true);
  });

  it('un día indeterminable no se descarta', () => {
    expect(esDiaActivo(null, ['sabado', 'domingo'])).toBe(true);
  });
});
