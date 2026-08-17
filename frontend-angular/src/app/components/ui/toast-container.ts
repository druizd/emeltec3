import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, type Toast } from '../../services/toast.service';

/**
 * Contenedor global de toasts. Se monta UNA vez en el layout. Escucha el
 * ToastService y renderiza las notificaciones apiladas arriba a la derecha.
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Abajo a la derecha, no arriba: los toasts de alerta chocaban con el
         header y tapaban el dropdown de la campana justo cuando el operador
         lo estaba mirando. El bottom-24 deja libre el asistente flotante. -->
    <div
      class="pointer-events-none fixed bottom-24 right-4 z-[200] flex w-[min(92vw,360px)] flex-col-reverse gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      @for (t of toast.toasts(); track t.id) {
        <div
          [class]="
            'toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg backdrop-blur-sm ' +
            toneClass(t)
          "
          role="status"
        >
          <span class="material-symbols-outlined mt-0.5 shrink-0 text-[18px]" aria-hidden="true">{{
            icon(t)
          }}</span>
          @if (t.onClick) {
            <button
              type="button"
              (click)="activar(t)"
              class="min-w-0 flex-1 text-left transition-opacity hover:opacity-80 active:scale-[0.99]"
            >
              @if (t.title) {
                <span class="block text-caption-xs font-bold uppercase tracking-wider opacity-70">
                  {{ t.title }}
                </span>
              }
              <span class="block text-body-sm font-semibold leading-snug">{{ t.message }}</span>
              <span class="mt-0.5 block text-caption-xs underline opacity-70">Ver el sitio</span>
            </button>
          } @else {
            <div class="min-w-0 flex-1">
              @if (t.title) {
                <p class="text-caption-xs font-bold uppercase tracking-wider opacity-70">
                  {{ t.title }}
                </p>
              }
              <p class="text-body-sm font-semibold leading-snug">{{ t.message }}</p>
            </div>
          }
          <button
            type="button"
            (click)="toast.dismiss(t.id)"
            class="shrink-0 rounded p-0.5 text-current/60 transition-colors hover:bg-black/5 hover:text-current active:scale-90"
            aria-label="Cerrar notificación"
          >
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-in {
        animation: toast-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast-in {
          animation: none;
        }
      }
    `,
  ],
})
export class ToastContainerComponent {
  readonly toast = inject(ToastService);

  activar(t: Toast): void {
    t.onClick?.();
    this.toast.dismiss(t.id);
  }

  icon(t: Toast): string {
    if (t.type === 'alerta') {
      return t.severidad === 'critica' ? 'e911_emergency' : 'notifications_active';
    }
    return t.type === 'success' ? 'check_circle' : t.type === 'error' ? 'error' : 'info';
  }

  toneClass(t: Toast): string {
    if (t.type === 'alerta') {
      // Mismos colores de severidad que usan las tarjetas de alarma.
      switch (t.severidad) {
        case 'critica':
          return 'border-rose-300 bg-rose-50 text-rose-800';
        case 'alta':
          return 'border-orange-200 bg-orange-50 text-orange-800';
        case 'media':
          return 'border-amber-200 bg-amber-50 text-amber-800';
        default:
          return 'border-emerald-200 bg-emerald-50 text-emerald-800';
      }
    }
    switch (t.type) {
      case 'success':
        return 'border-emerald-200 bg-emerald-50 text-emerald-800';
      case 'error':
        return 'border-red-200 bg-red-50 text-red-800';
      default:
        return 'border-slate-200 bg-white text-slate-700';
    }
  }
}
