import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlertNotificationsService } from './alert-notifications.service';
import { ToastService } from './toast.service';
import type { EventoReciente } from './alerta.service';

function evento(over: Partial<EventoReciente> = {}): EventoReciente {
  return {
    id: 'EV1',
    severidad: 'alta',
    mensaje: 'Nivel sobre umbral',
    triggered_at: '2026-08-17T16:00:00.000Z',
    sitio_id: 'S106',
    empresa_id: 'E101',
    alerta_nombre: 'Regla',
    sitio_desc: 'Vertiente 1',
    tipo_sitio: 'pozo',
    ...over,
  };
}

function resumen(recientes: EventoReciente[]) {
  return {
    ok: true,
    data: {
      activas: recientes.length,
      sin_revisar: recientes.length,
      no_leidas: recientes.length,
      criticas: recientes.filter((e) => e.severidad === 'critica').length,
      altas: recientes.filter((e) => e.severidad === 'alta').length,
      medias: 0,
      bajas: 0,
      recientes,
    },
  };
}

describe('AlertNotificationsService', () => {
  let service: AlertNotificationsService;
  let http: HttpTestingController;
  let toast: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(AlertNotificationsService);
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    service.detener();
  });

  /**
   * Responde el poll pendiente. Los tests de lógica usan `refrescar()` en vez
   * de `iniciar()` porque el primero emite el request de forma síncrona: el
   * `timer(0, …)` del polling recién dispara en el próximo macrotask.
   */
  function responder(recientes: EventoReciente[]): void {
    http.expectOne((r) => r.url.includes('/api/resumen')).flush(resumen(recientes));
  }

  /** Cede el hilo para que el timer del polling alcance a emitir. */
  const proximoTick = () => new Promise((r) => setTimeout(r, 0));

  it('no dispara popups en el primer poll: lo pendiente al abrir la app no es novedad', () => {
    service.refrescar();
    responder([evento({ id: 'A', severidad: 'critica' }), evento({ id: 'B' })]);

    expect(service.sinRevisar()).toBe(2);
    // La campana muestra las 2, pero nadie recibe dos popups por entrar.
    expect(toast.toasts().length).toBe(0);
  });

  it('dispara popup solo para los eventos que aparecen después del primer poll', () => {
    service.refrescar();
    responder([evento({ id: 'A' })]); // siembra
    service.refrescar();
    responder([evento({ id: 'B', severidad: 'critica' }), evento({ id: 'A' })]);

    expect(toast.toasts().length).toBe(1);
    expect(toast.toasts()[0].severidad).toBe('critica');
  });

  it('ignora media y baja para el popup, pero las cuenta en la campana', () => {
    service.refrescar();
    responder([]);
    service.refrescar();
    responder([evento({ id: 'M', severidad: 'media' }), evento({ id: 'B2', severidad: 'baja' })]);

    expect(toast.toasts().length).toBe(0);
    expect(service.sinRevisar()).toBe(2);
  });

  it('no repite el popup de un evento ya notificado', () => {
    service.refrescar();
    responder([]);
    service.refrescar();
    responder([evento({ id: 'X', severidad: 'alta' })]);
    expect(toast.toasts().length).toBe(1);

    service.refrescar();
    responder([evento({ id: 'X', severidad: 'alta' })]);
    expect(toast.toasts().length).toBe(1);
  });

  it('la alerta crítica no se auto-descarta', () => {
    service.refrescar();
    responder([]);
    service.refrescar();
    responder([evento({ id: 'C', severidad: 'critica' })]);

    // Un toast sin timeout permanece hasta que el operador lo cierre.
    expect(toast.toasts()).toHaveLength(1);
    expect(toast.toasts()[0].onClick).toBeTypeOf('function');
  });

  it('un evento que reaparece tras ser reconocido vuelve a notificar', () => {
    service.refrescar();
    responder([]);
    service.refrescar();
    responder([evento({ id: 'R', severidad: 'alta' })]);
    expect(toast.toasts().length).toBe(1);

    // Alguien lo reconoce → sale de la lista de pendientes.
    service.refrescar();
    responder([]);
    // Vuelve a dispararse más tarde.
    service.refrescar();
    responder([evento({ id: 'R', severidad: 'alta' })]);

    expect(toast.toasts().length).toBe(2);
  });

  it('un fallo de red conserva el último conteo conocido', () => {
    service.refrescar();
    responder([evento({ id: 'A' }), evento({ id: 'B' })]);
    expect(service.sinRevisar()).toBe(2);

    service.refrescar();
    http
      .expectOne((r) => r.url.includes('/api/resumen'))
      .error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    expect(service.error()).toBe(true);
    expect(service.sinRevisar()).toBe(2);
  });

  it('iniciar() arranca el polling y es idempotente', async () => {
    service.iniciar();
    service.iniciar(); // segunda llamada: no debe abrir otro timer
    await proximoTick();

    // Exactamente un request en vuelo, no dos.
    const pendientes = http.match((r) => r.url.includes('/api/resumen'));
    expect(pendientes.length).toBe(1);
    pendientes[0].flush(resumen([]));
    http.verify();
  });
});
