/**
 * La plataforma muestra y declara en UTC-4 fijo, pero el reloj chileno corre
 * una hora entre septiembre y abril. `chileSummerTimeOffsetHours` es lo que
 * decide si la leyenda de pantalla menciona ese desfase, así que tiene que dar
 * 0 en invierno y 1 en verano sin depender de la zona del navegador.
 */
import { chileSummerTimeOffsetHours, isChileSummerTime } from './timezone';

describe('chileSummerTimeOffsetHours', () => {
  it('da 0 en invierno, cuando Chile ya está en UTC-4', () => {
    expect(chileSummerTimeOffsetHours(new Date('2026-07-15T12:00:00Z'))).toBe(0);
    expect(isChileSummerTime(new Date('2026-07-15T12:00:00Z'))).toBe(false);
  });

  it('da 1 en verano, cuando el reloj de pared va en UTC-3', () => {
    expect(chileSummerTimeOffsetHours(new Date('2026-01-15T12:00:00Z'))).toBe(1);
    expect(isChileSummerTime(new Date('2026-01-15T12:00:00Z'))).toBe(true);
  });

  it('cambia en el salto del primer sábado de septiembre de 2026', () => {
    // 06-09-2026 03:00 UTC = 23:00 del 05-09 en Chile, todavía UTC-4.
    expect(chileSummerTimeOffsetHours(new Date('2026-09-06T03:00:00Z'))).toBe(0);
    // 06-09-2026 05:00 UTC = 02:00 del 06-09 en Chile, ya UTC-3.
    expect(chileSummerTimeOffsetHours(new Date('2026-09-06T05:00:00Z'))).toBe(1);
  });
});
