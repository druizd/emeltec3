import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DgaSlotsMantenimientoComponent } from './dga-slots-mantenimiento';
import type { DgaBulkSlotActionResult, DgaSlotsResumen } from '../../../../services/dga.service';

/**
 * Lógica del panel de mantenimiento de slots DGA.
 *
 * Dos cosas se pueden ir mal en silencio y las dos tienen consecuencias sobre
 * declaraciones reales:
 *
 *   1. Contar como afectables slots que el backend NO va a tocar. La pantalla
 *      prometería 12 y el backend afectaría 6, y el operador no sabría si el
 *      resto falló o nunca entraba.
 *   2. Anclar mal la zona horaria. `datetime-local` no lleva zona; si se deja
 *      que el navegador use la del sistema, en verano chileno (UTC−3) el rango
 *      se corre una hora y se recalculan slots equivocados.
 */
function crear(): DgaSlotsMantenimientoComponent {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const ref = TestBed.createComponent(DgaSlotsMantenimientoComponent);
  ref.componentRef.setInput('siteId', 'S128');
  return ref.componentInstance;
}

function resumen(estados: { estatus: string; total: number }[]): DgaSlotsResumen {
  return { estados, total: estados.reduce((a, e) => a + e.total, 0), limite: 800 };
}

/** `desdeIso`/`hastaIso` son privados: se acceden por cast, como en otros specs. */
function isos(c: DgaSlotsMantenimientoComponent): { desde: string; hasta: string } {
  const priv = c as unknown as { desdeIso(): string; hastaIso(): string };
  return { desde: priv.desdeIso(), hasta: priv.hastaIso() };
}

describe('DgaSlotsMantenimientoComponent', () => {
  let c: DgaSlotsMantenimientoComponent;

  beforeEach(() => {
    c = crear();
  });

  describe('cuántos slots se van a afectar', () => {
    it('suma solo los estados que el backend puede tocar', () => {
      c.resumen.set(
        resumen([
          { estatus: 'pendiente', total: 6 },
          { estatus: 'requires_review', total: 5 },
          { estatus: 'fallido', total: 2 },
          { estatus: 'enviado', total: 1 },
          { estatus: 'vacio', total: 580 },
        ]),
      );
      // 6 + 5 + 2. El enviado y los vacios quedan fuera.
      expect(c.tocables()).toBe(13);
    });

    it('el caso real de S128: 11 de 12, el que sobra es el enviado', () => {
      c.resumen.set(
        resumen([
          { estatus: 'pendiente', total: 6 },
          { estatus: 'requires_review', total: 5 },
          { estatus: 'enviado', total: 1 },
        ]),
      );
      expect(c.tocables()).toBe(11);
    });

    it('marca enviado y enviando como intocables', () => {
      expect(c.esTocable('enviado')).toBe(false);
      expect(c.esTocable('enviando')).toBe(false);
      expect(c.esTocable('vacio')).toBe(false);
      expect(c.esTocable('pendiente')).toBe(true);
      expect(c.esTocable('requires_review')).toBe(true);
      expect(c.esTocable('fallido')).toBe(true);
    });

    it('sin resumen no promete nada', () => {
      expect(c.tocables()).toBe(0);
    });
  });

  describe('zona horaria del rango', () => {
    it('ancla en UTC−4 y no en la zona del navegador', () => {
      c.desde.set('2026-09-04T13:00');
      c.hasta.set('2026-09-07T00:00');
      const { desde, hasta } = isos(c);
      // 13:00 hora Chile = 17:00 UTC, que es el corte real del caso S128.
      expect(desde).toBe('2026-09-04T13:00:00-04:00');
      expect(hasta).toBe('2026-09-07T00:00:00-04:00');
      expect(new Date(desde).toISOString()).toBe('2026-09-04T17:00:00.000Z');
    });
  });

  describe('habilitación de las acciones', () => {
    beforeEach(() => {
      c.desde.set('2026-09-04T13:00');
      c.hasta.set('2026-09-07T00:00');
      c.nota.set('Corregida la unidad del caudal');
      c.resumen.set(resumen([{ estatus: 'pendiente', total: 6 }]));
    });

    it('con rango, nota y slots afectables: habilitado', () => {
      expect(c.puedeEjecutar()).toBe(true);
    });

    it('exige nota de al menos 5 caracteres', () => {
      c.nota.set('ok');
      expect(c.notaValida()).toBe(false);
      expect(c.puedeEjecutar()).toBe(false);
    });

    it('no habilita si no hay nada que tocar', () => {
      c.resumen.set(resumen([{ estatus: 'enviado', total: 12 }]));
      expect(c.puedeEjecutar()).toBe(false);
    });

    it('rechaza un rango invertido o vacío', () => {
      c.hasta.set('2026-09-01T00:00');
      expect(c.rangoValido()).toBe(false);
      c.hasta.set('2026-09-04T13:00');
      expect(c.rangoValido()).toBe(false);
    });

    it('no habilita mientras hay una operación en curso', () => {
      c.busy.set('recalcular');
      expect(c.puedeEjecutar()).toBe(false);
    });
  });

  describe('cambiar el rango invalida el resumen', () => {
    it('deja de prometer un conteo que ya no corresponde a las fechas', () => {
      c.resumen.set(resumen([{ estatus: 'pendiente', total: 6 }]));
      c.onRangoChange('hasta', '2026-09-10T00:00');
      expect(c.resumen()).toBeNull();
      expect(c.tocables()).toBe(0);
      expect(c.puedeEjecutar()).toBe(false);
    });
  });

  describe('resultado', () => {
    it('noTocados explica la diferencia entre el rango y lo afectado', () => {
      const res: DgaBulkSlotActionResult = {
        action: 'dar_de_baja',
        afectados: 11,
        limite: 800,
        antes: [
          { estatus: 'pendiente', total: 6 },
          { estatus: 'requires_review', total: 5 },
          { estatus: 'enviado', total: 1 },
        ],
      };
      expect(c.noTocados(res)).toBe(1);
    });

    it('sin diferencia devuelve 0 y la UI no muestra la nota', () => {
      const res: DgaBulkSlotActionResult = {
        action: 'recalcular',
        afectados: 55,
        limite: 800,
        antes: [{ estatus: 'pendiente', total: 55 }],
      };
      expect(c.noTocados(res)).toBe(0);
    });
  });

  describe('etiquetas de estado', () => {
    it('traduce los estados del backend', () => {
      expect(c.etiquetaEstado('requires_review')).toBe('Requiere revisión');
      expect(c.etiquetaEstado('vacio')).toBe('Vacío');
    });

    it('un estado desconocido se muestra tal cual en vez de quedar en blanco', () => {
      expect(c.etiquetaEstado('estado_nuevo')).toBe('estado_nuevo');
    });
  });
});
