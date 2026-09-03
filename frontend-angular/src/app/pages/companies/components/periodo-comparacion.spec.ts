import { describe, expect, it } from 'vitest';
import {
  diasInclusivos,
  hoyChileIso,
  mesLabel,
  presetPeriodos,
  sumarConsumo,
  sumarDias,
  variacionPct,
} from './periodo-comparacion';

describe('periodo-comparacion', () => {
  describe('sumarDias / diasInclusivos', () => {
    it('cruza fin de mes y de año', () => {
      expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
      expect(sumarDias('2026-02-28', 1)).toBe('2026-03-01');
      expect(diasInclusivos('2026-09-01', '2026-09-03')).toBe(3);
      expect(diasInclusivos('2026-09-03', '2026-09-03')).toBe(1);
    });

    it('no se desfasa por el cambio de hora de Chile (primer domingo de septiembre)', () => {
      // 2026-09-06 es el primer domingo de septiembre: Chile pasa a UTC-3.
      expect(sumarDias('2026-09-05', 1)).toBe('2026-09-06');
      expect(sumarDias('2026-09-06', 1)).toBe('2026-09-07');
      expect(diasInclusivos('2026-09-05', '2026-09-07')).toBe(3);
    });
  });

  describe('hoyChileIso', () => {
    it('usa la fecha de Chile, no la UTC', () => {
      // 2026-09-04 02:30Z todavía es 03-09 en Chile (UTC-4).
      expect(hoyChileIso(new Date('2026-09-04T02:30:00Z'))).toBe('2026-09-03');
      expect(hoyChileIso(new Date('2026-09-04T05:00:00Z'))).toBe('2026-09-04');
    });
  });

  describe('presetPeriodos', () => {
    it('semana: lunes→hoy contra los mismos días de la semana anterior', () => {
      // 2026-09-03 es jueves → semana parte el lunes 31-08.
      const { a, b } = presetPeriodos('semana', '2026-09-03');
      expect(a).toEqual({ label: 'Esta semana', desde: '2026-08-31', hasta: '2026-09-03' });
      expect(b.desde).toBe('2026-08-24');
      expect(b.hasta).toBe('2026-08-27');
      expect(diasInclusivos(b.desde, b.hasta)).toBe(diasInclusivos(a.desde, a.hasta));
    });

    it('semana: un lunes compara 1 día contra 1 día', () => {
      const { a, b } = presetPeriodos('semana', '2026-08-31');
      expect(a.desde).toBe('2026-08-31');
      expect(b).toMatchObject({ desde: '2026-08-24', hasta: '2026-08-24' });
    });

    it('semana: un domingo cubre la semana completa', () => {
      const { a, b } = presetPeriodos('semana', '2026-09-06');
      expect(a).toMatchObject({ desde: '2026-08-31', hasta: '2026-09-06' });
      expect(b).toMatchObject({ desde: '2026-08-24', hasta: '2026-08-30' });
    });

    it('mes: día 1→hoy contra los mismos días del mes anterior', () => {
      const { a, b } = presetPeriodos('mes', '2026-09-03');
      expect(a).toEqual({ label: 'Septiembre 2026', desde: '2026-09-01', hasta: '2026-09-03' });
      expect(b).toEqual({
        label: 'Agosto 2026 · mismos días',
        desde: '2026-08-01',
        hasta: '2026-08-03',
      });
    });

    it('mes: si el mes anterior es más corto, B termina en su último día', () => {
      const { b } = presetPeriodos('mes', '2026-03-30');
      expect(b).toMatchObject({ desde: '2026-02-01', hasta: '2026-02-28' });
    });

    it('mes: enero compara contra diciembre del año anterior', () => {
      const { a, b } = presetPeriodos('mes', '2026-01-15');
      expect(a.label).toBe('Enero 2026');
      expect(b).toMatchObject({ desde: '2025-12-01', hasta: '2025-12-15' });
      expect(b.label).toBe('Diciembre 2025 · mismos días');
    });

    it('7d: dos ventanas contiguas de 7 días', () => {
      const { a, b } = presetPeriodos('7d', '2026-09-03');
      expect(a).toMatchObject({ desde: '2026-08-28', hasta: '2026-09-03' });
      expect(b).toMatchObject({ desde: '2026-08-21', hasta: '2026-08-27' });
    });
  });

  it('mesLabel capitaliza el mes', () => {
    expect(mesLabel('2026-09-01')).toBe('Septiembre 2026');
    expect(mesLabel('2025-12-31')).toBe('Diciembre 2025');
  });

  describe('variacionPct', () => {
    it('calcula la variación de A respecto a B con 1 decimal', () => {
      expect(variacionPct(110, 100)).toBe(10);
      expect(variacionPct(90, 100)).toBe(-10);
      expect(variacionPct(1, 3)).toBe(-66.7);
    });

    it('devuelve 0 cuando falta un lado o B es 0', () => {
      expect(variacionPct(null, 100)).toBe(0);
      expect(variacionPct(100, null)).toBe(0);
      expect(variacionPct(100, 0)).toBe(0);
    });
  });

  describe('sumarConsumo', () => {
    const dias = [
      { dia: '2026-08-30', delta: 100, muestras: 288 },
      { dia: '2026-08-31', delta: 50, muestras: 288 },
      { dia: '2026-09-01', delta: null, muestras: 10 },
      { dia: '2026-09-02', delta: 25, muestras: 0 },
      { dia: '2026-09-03', delta: 5, muestras: 288 },
    ];

    it('suma solo los días dentro del rango y con muestras', () => {
      const total = sumarConsumo(dias, { label: '', desde: '2026-08-31', hasta: '2026-09-03' });
      // 50 (31-08) + 0 (01-09 delta null) + 5 (03-09); el 02-09 no tiene muestras.
      expect(total).toBe(55);
    });

    it('devuelve null si ningún día del rango tiene muestras', () => {
      expect(
        sumarConsumo(dias, { label: '', desde: '2026-09-02', hasta: '2026-09-02' }),
      ).toBeNull();
      expect(sumarConsumo([], { label: '', desde: '2026-09-01', hasta: '2026-09-03' })).toBeNull();
    });
  });
});
