import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-admin-form-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (!selected()) {
      <button type="submit" [disabled]="busy() === createKey()" class="primary-button">
        <span class="material-symbols-outlined text-[18px]">{{ createIcon() }}</span>
        {{ busy() === createKey() ? 'Guardando' : createLabel() }}
      </button>
    } @else if (!editMode()) {
      <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
        <button type="button" (click)="enableEdit.emit()" class="secondary-button">
          <span class="material-symbols-outlined text-[18px]">edit</span>
          Editar datos
        </button>
        <button
          type="button"
          (click)="remove.emit()"
          [disabled]="busy() === deleteKey()"
          class="danger-button"
          [attr.aria-label]="'Eliminar ' + (entityLabel() || 'registro')"
        >
          <span class="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    } @else {
      <div class="grid gap-2 sm:grid-cols-2">
        <button type="submit" [disabled]="busy() === updateKey()" class="primary-button">
          <span class="material-symbols-outlined text-[18px]">save</span>
          {{ busy() === updateKey() ? 'Actualizando' : 'Actualizar' }}
        </button>
        <button type="button" (click)="cancelEdit.emit()" class="secondary-button">Cancelar</button>
      </div>
    }
  `,
  styles: [
    `
      .primary-button,
      .secondary-button,
      .danger-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-family: var(--font-body);
        cursor: pointer;
        transition: all 160ms ease;
      }
      .primary-button {
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-primary);
        background: var(--color-primary);
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: white;
      }
      .primary-button:hover:not(:disabled) {
        background: var(--color-primary-container);
        border-color: var(--color-primary-container);
        box-shadow: 0 4px 12px rgba(13, 175, 189, 0.25);
      }
      .primary-button:active:not(:disabled) {
        transform: scale(0.98);
      }
      .primary-button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .secondary-button {
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-on-surface-variant);
      }
      .secondary-button:hover {
        border-color: rgba(13, 175, 189, 0.3);
        background: rgba(13, 175, 189, 0.04);
        color: var(--color-primary-container);
      }
      .secondary-button:active {
        transform: scale(0.98);
      }
      .danger-button {
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid rgba(248, 113, 113, 0.3);
        background: rgba(248, 113, 113, 0.08);
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 600;
        color: #dc2626;
      }
      .danger-button:hover:not(:disabled) {
        background: rgba(248, 113, 113, 0.14);
        border-color: rgba(248, 113, 113, 0.45);
      }
      .danger-button:active:not(:disabled) {
        transform: scale(0.98);
      }
      .danger-button:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      @media (max-width: 760px) {
        .primary-button,
        .secondary-button,
        .danger-button {
          width: 100%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .primary-button,
        .secondary-button,
        .danger-button {
          transition: none;
        }
        .primary-button:active:not(:disabled),
        .secondary-button:active,
        .danger-button:active:not(:disabled) {
          transform: none;
        }
      }
    `,
  ],
})
export class AdminFormActionsComponent {
  readonly selected = input.required<boolean>();
  readonly editMode = input.required<boolean>();
  readonly busy = input<string>('');

  readonly createKey = input.required<string>();
  readonly updateKey = input.required<string>();
  readonly deleteKey = input.required<string>();

  readonly createLabel = input.required<string>();
  readonly createIcon = input<string>('add');
  readonly entityLabel = input<string>('');

  readonly enableEdit = output<void>();
  readonly cancelEdit = output<void>();
  readonly remove = output<void>();
}
