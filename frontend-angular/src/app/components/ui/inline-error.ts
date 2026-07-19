import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Banner de error inline reusable. Reemplaza ~8 copy-pastes con
 * shape consistente: rose-200 border, rose-50 bg, rose-800 text,
 * material-symbols error icon, optional action button.
 *
 * Usos típicos:
 *   - Polling falla → <app-inline-error [message]="loadError()"
 *                                       (action)="retry()" />
 *   - Empty state → <app-inline-error [message]="..."
 *                                     actionLabel="Volver al listado"
 *                                     actionIcon="arrow_back"
 *                                     (action)="volverAListado()" />
 *
 * El componente NO maneja open/close — el consumer gates con @if.
 * role="alert" + aria-live="polite" para SR announcement automático
 * al primer render. Sin tone variants — error UI es siempre rose;
 * info/warning son otros componentes.
 */
@Component({
  selector: 'app-inline-error',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="anim-banner flex flex-col items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-body-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">error</span>
        <span class="line-clamp-2 font-semibold" [attr.title]="message">{{ message }}</span>
      </div>
      @if (actionLabel) {
        <button
          type="button"
          (click)="action.emit()"
          class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 text-caption-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 sm:h-8"
        >
          <span class="material-symbols-outlined text-[14px]" aria-hidden="true">{{
            actionIcon
          }}</span>
          {{ actionLabel }}
        </button>
      }
    </div>
  `,
})
export class InlineErrorComponent {
  @Input({ required: true }) message: string | null = '';
  /** Texto del botón de acción. Cuando vacío, no se renderiza botón. */
  @Input() actionLabel = '';
  /** Material Symbol icon name del botón. Default refresh para Reintentar. */
  @Input() actionIcon = 'refresh';

  /** Emite cuando el usuario clic el botón de acción. */
  @Output() action = new EventEmitter<void>();
}
