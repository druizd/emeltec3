import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { AlertaService, type EventoReciente, type EventosResumen } from './alerta.service';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { getSiteTypeUi } from '../shared/site-type-ui';

/**
 * Vigilancia global de alertas para la campana del header.
 *
 * Poll cada 60s a `/api/resumen`, que ya viene scopeado por rol y empresa —
 * el usuario solo ve pendientes de los sitios que le corresponden. La cadencia
 * va a la par del worker de alertas (también 60s): un intervalo más corto solo
 * gastaría requests, porque no habría eventos nuevos que traer.
 *
 * Al detectar eventos que no estaban en el poll anterior, dispara un popup —
 * solo para severidad alta y crítica, para que una regla ruidosa no llene la
 * pantalla.
 */

const POLL_MS = 60_000;
const SEVERIDADES_POPUP = new Set(['alta', 'critica']);

@Injectable({ providedIn: 'root' })
export class AlertNotificationsService {
  private readonly alertas = inject(AlertaService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly resumen = signal<EventosResumen | null>(null);
  readonly cargando = signal(false);
  readonly error = signal(false);

  readonly sinRevisar = computed(() => this.resumen()?.sin_revisar ?? 0);
  readonly criticas = computed(() => this.resumen()?.criticas ?? 0);
  readonly recientes = computed(() => this.resumen()?.recientes ?? []);
  readonly hayCriticas = computed(() => this.criticas() > 0);

  /**
   * Ids ya vistos. En el PRIMER poll se siembra sin notificar: al abrir la
   * app, las alertas que ya estaban pendientes no son novedad y no deben
   * disparar diez popups de golpe.
   */
  private conocidos = new Set<string>();
  private sembrado = false;
  private sub: Subscription | null = null;

  /** Arranca el polling. Idempotente — el layout puede llamarlo varias veces. */
  iniciar(): void {
    if (this.sub) return;
    this.sub = timer(0, POLL_MS)
      .pipe(switchMap(() => this.alertas.resumen()))
      .subscribe({
        next: (data) => {
          this.cargando.set(false);
          this.error.set(false);
          this.resumen.set(data);
          this.procesarNuevos(data.recientes ?? []);
        },
        error: () => {
          this.cargando.set(false);
          // Un fallo de red no debe vaciar la campana: se conserva el último
          // valor conocido y solo se marca el estado de error.
          this.error.set(true);
        },
      });
    this.destroyRef.onDestroy(() => this.detener());
  }

  detener(): void {
    this.sub?.unsubscribe();
    this.sub = null;
    this.conocidos.clear();
    this.sembrado = false;
    this.resumen.set(null);
  }

  /** Fuerza un refresco inmediato (tras reconocer un evento, por ejemplo). */
  refrescar(): void {
    this.alertas.resumen().subscribe({
      next: (data) => {
        this.resumen.set(data);
        this.procesarNuevos(data.recientes ?? []);
      },
      error: () => this.error.set(true),
    });
  }

  private procesarNuevos(recientes: EventoReciente[]): void {
    if (!this.sembrado) {
      for (const e of recientes) this.conocidos.add(e.id);
      this.sembrado = true;
      return;
    }

    // Del más antiguo al más nuevo, para que los popups se apilen en orden.
    const nuevos = recientes.filter((e) => !this.conocidos.has(e.id)).reverse();
    for (const e of nuevos) {
      this.conocidos.add(e.id);
      if (!SEVERIDADES_POPUP.has(e.severidad)) continue;
      this.toast.alerta({
        title: `${e.severidad.toUpperCase()} · ${e.sitio_desc || e.sitio_id || 'Sitio'}`,
        message: e.mensaje || e.alerta_nombre || 'Alerta activa',
        severidad: e.severidad,
        onClick: () => this.irAlEvento(e),
      });
    }

    // Los ids que ya no están pendientes (reconocidos o resueltos por otro
    // operador) se sueltan: si el evento reapareciera, vuelve a ser novedad.
    const vigentes = new Set(recientes.map((e) => e.id));
    for (const id of this.conocidos) {
      if (!vigentes.has(id)) this.conocidos.delete(id);
    }
  }

  /**
   * Navega al detalle del sitio, abriendo la pestaña de alertas. El
   * `?tab=alertas` lo respeta el detalle de pozo; los otros tipos de sitio
   * lo ignoran y abren su pestaña por defecto.
   */
  irAlEvento(e: EventoReciente): void {
    if (!e.sitio_id) return;
    const segmento = getSiteTypeUi(e.tipo_sitio ?? '').routeSegment;
    this.router.navigate(['/companies', e.sitio_id, segmento], {
      queryParams: { tab: 'alertas' },
    });
  }

  /** `true` si el usuario tiene sesión con alcance para ver alertas. */
  habilitado(): boolean {
    return this.auth.isAuthenticated();
  }
}
