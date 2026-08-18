/**
 * Tests de los filtros de la cola de revisión DGA.
 *
 * El foco está en la conversión de fecha. El <input type="date"> entrega
 * 'YYYY-MM-DD' sin zona, pero el backend compara contra un timestamptz: si el
 * día no se expande al rango correcto en hora de Chile, un "hasta el 17" deja
 * fuera las últimas horas del 17 y el usuario ve menos de lo que hay.
 *
 * El truco ingenuo (toLocaleString + reparse) devuelve offset 0 cuando el
 * navegador ya está en Chile — que es el caso normal de esta app — así que la
 * regresión pasaría desapercibida sin estos casos.
 */
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DgaReviewComponent } from './dga-review';
import { DgaReviewQueuePage, DgaReviewFilters, DgaService } from '../../services/dga.service';

const PAGINA_VACIA = { slots: [], total: 0, sitios: [] };

describe('DgaReviewComponent — filtros', () => {
  let capturado: DgaReviewFilters[];
  let dga: Partial<DgaService>;

  beforeEach(() => {
    capturado = [];
    dga = {
      listReviewQueue: (filters: DgaReviewFilters = {}) => {
        capturado.push(filters);
        return of(PAGINA_VACIA as DgaReviewQueuePage);
      },
    };
    TestBed.configureTestingModule({
      imports: [DgaReviewComponent],
      providers: [{ provide: DgaService, useValue: dga }],
    });
  });

  function crear(): DgaReviewComponent {
    return TestBed.createComponent(DgaReviewComponent).componentInstance;
  }

  it('no manda fechas cuando no hay filtros', () => {
    crear();
    expect(capturado.length).toBe(1);
    expect(capturado[0]!.desde).toBeUndefined();
    expect(capturado[0]!.hasta).toBeUndefined();
    expect(capturado[0]!.siteId).toBeUndefined();
  });

  it('expande "desde" al inicio del día en hora de Chile (UTC-4 en invierno)', () => {
    const c = crear();
    c.onFilterChange(c.filterDesde, '2026-07-01');
    // 00:00 del 1-jul en Chile = 04:00 UTC del mismo día.
    expect(capturado.at(-1)!.desde).toBe('2026-07-01T04:00:00.000Z');
  });

  it('expande "hasta" al FIN del día, no a su medianoche', () => {
    const c = crear();
    c.onFilterChange(c.filterHasta, '2026-07-17');
    // 23:59:59.999 del 17-jul en Chile = 03:59:59.999 UTC del 18.
    // Si diera '2026-07-17T23:59:59.999Z' estaríamos perdiendo 4 horas del 17.
    expect(capturado.at(-1)!.hasta).toBe('2026-07-18T03:59:59.999Z');
  });

  it('respeta el horario de verano chileno (UTC-3 en enero)', () => {
    const c = crear();
    c.onFilterChange(c.filterDesde, '2026-01-15');
    expect(capturado.at(-1)!.desde).toBe('2026-01-15T03:00:00.000Z');
  });

  it('manda el site_id elegido', () => {
    const c = crear();
    c.onFilterChange(c.filterSite, 'S127');
    expect(capturado.at(-1)!.siteId).toBe('S127');
  });

  it('hasFilters distingue vacío de filtrado', () => {
    const c = crear();
    expect(c.hasFilters()).toBe(false);
    c.onFilterChange(c.filterDesde, '2026-07-01');
    expect(c.hasFilters()).toBe(true);
    c.clearFilters();
    expect(c.hasFilters()).toBe(false);
    expect(capturado.at(-1)!.desde).toBeUndefined();
  });

  it('truncado avisa solo cuando el total supera lo mostrado', () => {
    const c = crear();
    c.slots.set([{ site_id: 'S1', ts: 'x' } as never]);
    c.total.set(1);
    expect(c.truncado()).toBe(false);
    c.total.set(340);
    expect(c.truncado()).toBe(true);
  });
});
