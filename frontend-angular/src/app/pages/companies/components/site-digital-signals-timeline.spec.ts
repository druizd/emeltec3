import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import type { SiteDashboardHistoryEntry } from '@emeltec/shared';
import { SiteDigitalSignalsTimelineComponent } from './site-digital-signals-timeline';

/**
 * Cobertura de la lógica que convierte las filas del histórico en bandas.
 *
 * Lo que importa acá: que los tramos contiguos se fusionen (si no, un día a
 * 1 minuto son 1440 `<span>` por señal), que "sin lectura" no se dibuje como
 * apagado, y que el catálogo de señales salga de los propios datos.
 */

/** Una fila del histórico con las señales digitales indicadas. */
function fila(
  minuto: number,
  digitales: Record<string, { valor: number | null; bit: number; ok?: boolean }>,
): SiteDashboardHistoryEntry {
  const mm = String(minuto).padStart(2, '0');
  return {
    timestamp: `2026-01-01T03:${mm}:00Z`,
    digitales: Object.fromEntries(
      Object.entries(digitales).map(([key, valor]) => [
        key,
        {
          ok: valor.ok ?? true,
          valor: valor.valor,
          alias: key === 'bomba' ? 'Bomba activa' : 'Falla térmico',
          bit: valor.bit,
          error: null,
        },
      ]),
    ),
  } as SiteDashboardHistoryEntry;
}

describe('SiteDigitalSignalsTimelineComponent', () => {
  let component: SiteDigitalSignalsTimelineComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    component = TestBed.createComponent(SiteDigitalSignalsTimelineComponent).componentInstance;
  });

  it('sin filas no dibuja ninguna banda', () => {
    component.rows.set([]);
    expect(component.lanes()).toEqual([]);
  });

  it('una sola fila no alcanza para un eje de tiempo', () => {
    component.rows.set([fila(0, { bomba: { valor: 1, bit: 0 } })]);
    expect(component.lanes()).toEqual([]);
  });

  it('un sitio sin señales digitales no dibuja nada', () => {
    component.rows.set([
      { timestamp: '2026-01-01T03:00:00Z', digitales: {} } as SiteDashboardHistoryEntry,
      { timestamp: '2026-01-01T03:01:00Z', digitales: {} } as SiteDashboardHistoryEntry,
    ]);
    expect(component.lanes()).toEqual([]);
  });

  it('arma una banda por señal, ordenadas por bit', () => {
    component.rows.set([
      fila(0, { falla: { valor: 0, bit: 2 }, bomba: { valor: 1, bit: 0 } }),
      fila(1, { falla: { valor: 0, bit: 2 }, bomba: { valor: 1, bit: 0 } }),
    ]);

    expect(component.lanes().map((lane) => lane.bit)).toEqual([0, 2]);
    expect(component.lanes()[0]?.alias).toBe('Bomba activa');
  });

  it('fusiona los tramos contiguos con el mismo estado', () => {
    // Cuatro buckets seguidos en 1 tienen que ser UN tramo, no cuatro.
    component.rows.set([
      fila(0, { bomba: { valor: 1, bit: 0 } }),
      fila(1, { bomba: { valor: 1, bit: 0 } }),
      fila(2, { bomba: { valor: 1, bit: 0 } }),
      fila(3, { bomba: { valor: 1, bit: 0 } }),
    ]);

    const lane = component.lanes()[0]!;
    expect(lane.tramos).toHaveLength(1);
    expect(lane.tramos[0]?.estado).toBe('activo');
  });

  it('corta un tramo nuevo en cada cambio de estado', () => {
    component.rows.set([
      fila(0, { bomba: { valor: 0, bit: 0 } }),
      fila(1, { bomba: { valor: 1, bit: 0 } }),
      fila(2, { bomba: { valor: 1, bit: 0 } }),
      fila(3, { bomba: { valor: 0, bit: 0 } }),
    ]);

    const lane = component.lanes()[0]!;
    expect(lane.tramos.map((tramo) => tramo.estado)).toEqual(['inactivo', 'activo', 'inactivo']);
  });

  it('los tramos cubren el eje completo sin huecos ni solapes', () => {
    component.rows.set([
      fila(0, { bomba: { valor: 0, bit: 0 } }),
      fila(1, { bomba: { valor: 1, bit: 0 } }),
      fila(2, { bomba: { valor: 0, bit: 0 } }),
    ]);

    const tramos = component.lanes()[0]!.tramos;
    expect(tramos[0]?.left).toBeCloseTo(0, 6);
    let cursor = 0;
    for (const tramo of tramos) {
      expect(tramo.left).toBeCloseTo(cursor, 6);
      cursor += tramo.width;
    }
    expect(cursor).toBeCloseTo(100, 6);
  });

  it('cuenta las activaciones (flancos de 0 a 1)', () => {
    component.rows.set([
      fila(0, { bomba: { valor: 0, bit: 0 } }),
      fila(1, { bomba: { valor: 1, bit: 0 } }),
      fila(2, { bomba: { valor: 0, bit: 0 } }),
      fila(3, { bomba: { valor: 1, bit: 0 } }),
      fila(4, { bomba: { valor: 1, bit: 0 } }),
    ]);

    expect(component.lanes()[0]?.activaciones).toBe(2);
  });

  it('una señal que arranca activa no cuenta como activación', () => {
    // No se vio el flanco: pudo haberse activado antes de la ventana.
    component.rows.set([
      fila(0, { bomba: { valor: 1, bit: 0 } }),
      fila(1, { bomba: { valor: 1, bit: 0 } }),
    ]);

    expect(component.lanes()[0]?.activaciones).toBe(0);
  });

  it('sin lectura se distingue de apagado', () => {
    // Un hueco de transmisión no puede leerse como "la bomba estuvo detenida".
    component.rows.set([
      fila(0, { bomba: { valor: 1, bit: 0 } }),
      fila(1, { bomba: { valor: null, bit: 0, ok: false } }),
      fila(2, { bomba: { valor: 0, bit: 0 } }),
    ]);

    const lane = component.lanes()[0]!;
    expect(lane.tramos.map((tramo) => tramo.estado)).toEqual(['activo', 'sin_dato', 'inactivo']);
    expect(component.tramoClass(lane.tramos[1]!)).toContain('amber');
    expect(component.tramoClass(lane.tramos[2]!)).toContain('slate');
  });

  it('un salto de sin_dato a activo no cuenta como activación', () => {
    component.rows.set([
      fila(0, { bomba: { valor: null, bit: 0, ok: false } }),
      fila(1, { bomba: { valor: 1, bit: 0 } }),
    ]);

    expect(component.lanes()[0]?.activaciones).toBe(0);
  });

  it('el badge refleja el ultimo estado de la ventana', () => {
    component.rows.set([
      fila(0, { bomba: { valor: 1, bit: 0 } }),
      fila(1, { bomba: { valor: 0, bit: 0 } }),
    ]);

    expect(component.lanes()[0]?.actual).toBe('inactivo');
    expect(component.badgeLabel('inactivo')).toBe('Inactiva');
    expect(component.badgeLabel('activo')).toBe('Activa');
    expect(component.badgeLabel('sin_dato')).toBe('Sin dato');
  });

  it('ordena por tiempo aunque el endpoint devuelva descendente', () => {
    // dashboard-history entrega ORDER BY time DESC.
    component.rows.set([
      fila(2, { bomba: { valor: 0, bit: 0 } }),
      fila(1, { bomba: { valor: 1, bit: 0 } }),
      fila(0, { bomba: { valor: 1, bit: 0 } }),
    ]);

    const lane = component.lanes()[0]!;
    expect(lane.tramos.map((tramo) => tramo.estado)).toEqual(['activo', 'inactivo']);
    expect(lane.actual).toBe('inactivo');
  });

  it('descubre una señal que solo aparece en los buckets recientes', () => {
    // Recién configurada: no está en las filas viejas.
    component.rows.set([
      fila(0, { bomba: { valor: 1, bit: 0 } }),
      fila(1, { bomba: { valor: 1, bit: 0 }, falla: { valor: 1, bit: 2 } }),
    ]);

    expect(component.lanes()).toHaveLength(2);
    const falla = component.lanes()[1]!;
    expect(falla.bit).toBe(2);
    // El bucket donde no existía se dibuja como sin lectura, no como apagada.
    expect(falla.tramos[0]?.estado).toBe('sin_dato');
  });

  it('descarta filas sin timestamp usable', () => {
    component.rows.set([
      { timestamp: 'no-es-fecha', digitales: {} } as SiteDashboardHistoryEntry,
      fila(0, { bomba: { valor: 1, bit: 0 } }),
      fila(1, { bomba: { valor: 0, bit: 0 } }),
    ]);

    expect(component.lanes()).toHaveLength(1);
    expect(component.lanes()[0]?.tramos).toHaveLength(2);
  });
});
