import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';

/**
 * Datos de un diálogo de confirmación. Reusable en cualquier flujo que
 * necesite confirmar una acción sensible (editar/eliminar) con el diseño
 * del proyecto, en vez del confirm() nativo del navegador.
 */
export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'primary';
  icon?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule],
  template: `
    @if (data(); as d) {
      <div
        class="anim-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
        animate.leave="anim-overlay-out"
        (click)="dismiss.emit()"
      >
        <section
          class="anim-panel w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]"
          role="dialog"
          cdkTrapFocus
          cdkTrapFocusAutoCapture
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          (click)="$event.stopPropagation()"
        >
          <div class="flex gap-4 border-b border-slate-100 px-5 py-5">
            <span
              [class]="
                (d.tone ?? 'primary') === 'danger'
                  ? 'material-symbols-outlined grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-50 text-[24px] text-red-600'
                  : 'material-symbols-outlined grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-tint-08 text-[24px] text-primary-container'
              "
              >{{ d.icon ?? ((d.tone ?? 'primary') === 'danger' ? 'warning' : 'help') }}</span
            >
            <div class="min-w-0">
              <h3 id="confirm-dialog-title" class="text-h6 font-semibold text-slate-900">
                {{ d.title }}
              </h3>
              <p class="mt-1 text-body-sm leading-6 text-slate-500">{{ d.message }}</p>
            </div>
          </div>
          <div class="flex flex-col-reverse gap-2 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              (click)="dismiss.emit()"
              class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition duration-100 hover:bg-slate-200 active:scale-[0.98]"
            >
              {{ d.cancelText ?? 'Cancelar' }}
            </button>
            <button
              type="button"
              (click)="accept.emit()"
              [class]="
                (d.tone ?? 'primary') === 'danger'
                  ? 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-caption font-bold text-white transition duration-100 hover:bg-rose-700 active:scale-[0.98]'
                  : 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition duration-100 hover:bg-primary-container active:scale-[0.98]'
              "
            >
              <span class="material-symbols-outlined text-[16px]">{{
                (d.tone ?? 'primary') === 'danger' ? 'delete' : 'check'
              }}</span>
              {{ d.confirmText ?? 'Confirmar' }}
            </button>
          </div>
        </section>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  readonly data = input<ConfirmDialogData | null>(null);
  readonly accept = output<void>();
  readonly dismiss = output<void>();
}
