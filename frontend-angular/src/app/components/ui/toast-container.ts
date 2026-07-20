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
    <div
      class="pointer-events-none fixed right-4 top-4 z-[200] flex w-[min(92vw,360px)] flex-col gap-2"
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
          <p class="min-w-0 flex-1 text-body-sm font-semibold leading-snug">{{ t.message }}</p>
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
          transform: translateY(-8px) scale(0.98);
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

  icon(t: Toast): string {
    return t.type === 'success' ? 'check_circle' : t.type === 'error' ? 'error' : 'info';
  }

  toneClass(t: Toast): string {
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
